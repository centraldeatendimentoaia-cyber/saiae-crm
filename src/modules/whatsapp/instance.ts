import { errorCode } from "@/lib/errors";
import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateMessageID,
    makeCacheableSignalKeyStore,
    WASocket,
    ConnectionState
} from "@whiskeysockets/baileys";
import { prisma } from "@/lib/prisma";
import { backfillContactNames } from "@/lib/personalize";
import { usePrismaAuthState } from "./auth/usePrismaAuthState";
import { Server } from "socket.io";
import pino from "pino";
import { bindSessionStore } from "./store";
import { syncGroups } from "./store/groups";
import { bindContactSync } from "./store/contacts";
import { bindAutoReply } from "./store/autoreply";
import { bindOptOut } from "./store/optout";
import { bindAgenteSalao } from "@/modules/agente-salao/agente";
import { marcarEnviadaPeloCrm } from "@/modules/agente-salao/enviados";
import { bindPpGuard } from "./store/ppguard";
import { antispam } from "./antispam";
import { logger } from "@/lib/logger";

const MAX_RECONNECT_ATTEMPTS = 3;

export class WhatsAppInstance {
    socket: WASocket | null = null;
    qr: string | null = null;
    rq: string | null = null;
    status: string = "DISCONNECTED";
    sessionId: string;
    userId: string;
    io: Server;
    config: any = {};
    startTime: Date | null = null;
    pairingCode: string | null = null;

    isStopped: boolean = false;
    private reconnectCount: number = 0;
    /** Called when instance auto-stops or logs out — lets manager remove it from Map */
    onRemovedFromManager: (() => void) | null = null;

    constructor(sessionId: string, userId: string, io: Server) {
        this.sessionId = sessionId;
        this.userId = userId;
        this.io = io;
    }

    async init() {
        const sessionData = await prisma.session.findUnique({
            where: { sessionId: this.sessionId },
            include: { botConfig: true }
        });
        if (!sessionData) {
            logger.warn("Instance", `Session ${this.sessionId} not found in DB, aborting init`);
            return;
        }
        this.config = sessionData?.config || {};
        const botConfig = (sessionData as any)?.botConfig;

        const { state, saveCreds } = await usePrismaAuthState(this.sessionId);
        const { version } = await fetchLatestBaileysVersion();

        this.socket = makeWASocket({
            version,
            logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || "error" }) as any,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: process.env.BAILEYS_LOG_LEVEL || "error" }) as any),
            },
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            markOnlineOnConnect: botConfig?.alwaysOnline ?? true,
            // Baixar o histórico inteiro pesa em memória, CPU e banco; ligue com WA_SYNC_FULL_HISTORY=true se precisar
            syncFullHistory: process.env.WA_SYNC_FULL_HISTORY === "true",
        });

        // Apply Anti-Spam Wrapper to sendMessage
        const originalSendMessage = this.socket.sendMessage.bind(this.socket);
        const sessionId = this.sessionId;
        this.socket.sendMessage = async function (jid: string, content: any, options?: any) {
            await antispam.enqueue(sessionId, jid, content);
            // registra o ID: o agente do salão distingue o que o CRM enviou do que uma pessoa escreveu pelo celular
            const messageId = options?.messageId || generateMessageID();
            marcarEnviadaPeloCrm(messageId);
            return originalSendMessage(jid, content, { ...options, messageId });
        } as any;

        // Bind Store for DB Sync
        bindSessionStore(this.socket, this.sessionId, this.io);

        // Bind Contact Sync
        bindContactSync(this.socket, this.sessionId);

        this.socket.ev.on("creds.update", saveCreds);

        // Sincroniza etiquetas do WhatsApp Business para o painel
        const LABEL_COLORS = ["#ff9485","#64c4ff","#ffd429","#dbf0d8","#ff9dff","#c3a5ff","#22c9a8","#ff6b6b","#7ec8e3","#f4a261","#8ac926","#e76f51","#6a4c93","#1982c4","#ffca3a","#ff595e","#8ac6d1","#b5838d","#a7c957","#9a8c98"];
        this.socket.ev.on("labels.edit" as any, async (label: any) => {
            try {
                const id = `${this.sessionId}:${label.id}`;
                if (label.deleted) {
                    await prisma.label.deleteMany({ where: { id } });
                    return;
                }
                const color = Number(label.color) || 0;
                const data = { name: label.name || `Etiqueta ${label.id}`, color, colorHex: LABEL_COLORS[color % LABEL_COLORS.length] };
                await prisma.label.upsert({ where: { id }, update: data, create: { id, sessionId: this.sessionId, ...data } });
            } catch (e) {
                logger.error("Instance", "Label sync failed:", e);
            }
        });
        this.socket.ev.on("labels.association" as any, async (ev: any) => {
            try {
                const assoc = ev?.association;
                if (!assoc || assoc.type !== "label_jid") return; // etiqueta em conversa (o Baileys usa "label_jid")
                const labelId = `${this.sessionId}:${assoc.labelId}`;
                if (ev.type === "add") {
                    // a associação pode chegar antes da etiqueta: cria um espaço reservado que o "labels.edit" completa
                    const exists = await prisma.label.findUnique({ where: { id: labelId } });
                    if (!exists) {
                        await prisma.label.create({ data: { id: labelId, sessionId: this.sessionId, name: `Etiqueta ${assoc.labelId}`, color: 0, colorHex: LABEL_COLORS[0] } }).catch(() => {});
                    }
                    await prisma.chatLabel.upsert({
                        where: { labelId_chatJid: { labelId, chatJid: assoc.chatId } },
                        update: {},
                        create: { labelId, chatJid: assoc.chatId },
                    });
                } else {
                    await prisma.chatLabel.deleteMany({ where: { labelId, chatJid: assoc.chatId } });
                }
            } catch (e) {
                logger.error("Instance", "Label association sync failed:", e);
            }
        });

        this.socket.ev.on("connection.update", async (update) => {
            await this.handleConnectionUpdate(update);
        });
    }

    async handleConnectionUpdate(update: Partial<ConnectionState>) {
        const { connection, lastDisconnect, qr } = update;

        try {
            if (qr) {
                if (this.isStopped) return;
                // Reset reconnect count on new QR (user is re-scanning)
                this.reconnectCount = 0;
                this.qr = qr;
                this.status = "SCAN_QR";

                this.io?.to(this.sessionId).emit("connection.update", { status: this.status, qr });

                await prisma.session.update({
                    where: { sessionId: this.sessionId },
                    data: { qr, status: "SCAN_QR" }
                });
            }

            if (connection === "close") {
                const code = (lastDisconnect?.error as any)?.output?.statusCode;
                const isLoggedOut = code === DisconnectReason.loggedOut;

                if (isLoggedOut) {
                    // Logged out: stop permanently, remove from memory
                    this.status = "LOGGED_OUT";
                    this.socket = null;
                    this.config = {};
                    this.io?.to(this.sessionId).emit("connection.update", { status: "LOGGED_OUT", qr: null });

                    logger.info("Instance", `Session ${this.sessionId} logged out. Deleting credentials...`);
                    try {
                        await prisma.$transaction([
                            prisma.session.update({
                                where: { sessionId: this.sessionId },
                                data: { status: "LOGGED_OUT", qr: null }
                            }),
                            prisma.authState.deleteMany({
                                where: { sessionId: this.sessionId }
                            })
                        ]);
                    } catch (e) { /* ignore */ }
                    logger.success("Instance", `Session ${this.sessionId} credentials deleted.`);

                    // Remove from memory manager
                    this.onRemovedFromManager?.();
                    return;
                }

                if (this.isStopped) {
                    // Explicitly stopped: preserve creds for restart
                    this.status = "STOPPED";
                    this.socket = null;
                    this.reconnectCount = 0;
                    this.io?.to(this.sessionId).emit("connection.update", { status: "STOPPED", qr: null });

                    await prisma.session.update({
                        where: { sessionId: this.sessionId },
                        data: { status: "STOPPED", qr: null }
                    }).catch(() => {});
                    logger.warn("Instance", `Session ${this.sessionId} stopped. Credentials preserved.`);

                    // Remove from memory manager
                    const { waManager } = require("./manager");
                    waManager.removeInstance(this.sessionId);
                    return;
                }

                // Unexpected disconnect: retry with limit
                this.reconnectCount++;
                const remaining = MAX_RECONNECT_ATTEMPTS - this.reconnectCount + 1;

                if (remaining > 0) {
                    this.status = "DISCONNECTED";
                    this.io?.to(this.sessionId).emit("connection.update", { status: "DISCONNECTED", qr: null });
                    await prisma.session.update({
                        where: { sessionId: this.sessionId },
                        data: { status: "DISCONNECTED", qr: null }
                    }).catch(() => {});

                    logger.warn("Instance",
                        `Session ${this.sessionId} disconnected. Reconnecting (${this.reconnectCount}/${MAX_RECONNECT_ATTEMPTS})...`
                    );
                    setTimeout(() => {
                        if (!this.isStopped) this.init();
                    }, 3000);
                } else {
                    // Max retries exceeded — auto-stop
                    this.status = "STOPPED";
                    this.socket = null;
                    this.reconnectCount = 0;
                    this.isStopped = true; // prevent further retries
                    this.io?.to(this.sessionId).emit("connection.update", { status: "STOPPED", qr: null });

                    await prisma.session.update({
                        where: { sessionId: this.sessionId },
                        data: { status: "STOPPED", qr: null }
                    }).catch(() => {});
                    logger.error("Instance",
                        `Session ${this.sessionId} max reconnects (${MAX_RECONNECT_ATTEMPTS}) reached. Auto-stopped.`
                    );

                    // Remove from memory manager
                    this.onRemovedFromManager?.();
                }
            }

            if (connection === "open") {
                // Connected — reset reconnect count
                this.reconnectCount = 0;
                this.isStopped = false;
                this.status = "CONNECTED";
                this.qr = null;
                this.startTime = new Date();

                this.io?.to(this.sessionId).emit("connection.update", { status: "CONNECTED", qr: null });

                // Força a ressincronização do estado do app para trazer as etiquetas
                setTimeout(() => {
                    (this.socket as any)?.resyncAppState?.(["regular", "regular_low", "regular_high"], true)
                        .catch((e: any) => logger.error("Instance", "Label resync failed:", e?.message || e));
                }, 8000);

                try {
                    const dbSession = await prisma.session.findUnique({ where: { sessionId: this.sessionId }, select: { id: true } });
                    if (dbSession) await backfillContactNames(dbSession.id);
                } catch (e) {
                    logger.error("Instance", "Contact name backfill failed:", e);
                }

                try {
                    await syncGroups(this.socket as WASocket, this.sessionId);
                } catch (e) {
                    logger.error("Instance", "Group sync failed:", e);
                }

                bindAutoReply(this.socket as WASocket, this.sessionId);
                bindOptOut(this.socket as WASocket, this.sessionId);
                bindAgenteSalao(this.socket as WASocket, this.sessionId);
                bindPpGuard(this.socket as WASocket, this.sessionId);

                await prisma.session.update({
                    where: { sessionId: this.sessionId },
                    data: { status: "CONNECTED", qr: null }
                });

                logger.success("Instance", `Session ${this.sessionId} connected and synced successfully`);
            }
        } catch (error) {
            if (errorCode(error) === 'P2025') {
                logger.warn("Instance", `Session ${this.sessionId} record not found during update. Stopping.`);
                this.socket?.end(undefined);
                this.socket = null;
            } else {
                logger.error("Instance", "Error in handleConnectionUpdate:", error);
            }
        }
    }

    async requestPairingCode(phoneNumber: string) {
        if (!this.socket) {
            throw new Error("Socket not initialized");
        }

        try {
            const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
            if (!cleanNumber) throw new Error("Invalid phone number");

            const code = await this.socket.requestPairingCode(cleanNumber);
            this.pairingCode = code;
            this.status = "SCAN_QR";

            this.io?.to(this.sessionId).emit("connection.update", {
                status: this.status,
                qr: this.qr,
                pairingCode: code
            });

            return code;
        } catch (error) {
            logger.error("Instance", "Pairing code error:", error);
            throw error;
        }
    }

    /** Clean shutdown without triggering reconnect */
    async shutdown() {
        this.isStopped = true;
        this.socket?.end(undefined);
        this.socket = null;
        this.reconnectCount = 0;
    }
}
