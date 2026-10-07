import cron from "node-cron";
import { personalizeFor } from "@/lib/personalize";
import { resolveSendJid } from "@/lib/wa-jid";
import cronParser from "cron-parser";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { logger } from "./logger";
import { assertCanSend, recordMessages } from "@/lib/plans";
import { isOptedOut } from "@/lib/optout";
import { onlyInteractedEnabled, hasInteracted, NO_INTERACTION_ERROR } from "@/lib/interaction";
import { startRetention } from "@/lib/retention";
import { resolveMedia } from "@/lib/media";
import { getSafeMode, safeGate, humanDelayMs, batchPauseMs } from "@/lib/safe-mode";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let running = false; // evita duas rodadas ao mesmo tempo
export function initScheduler() {
    // Run every minute
    cron.schedule("* * * * *", async () => {
        if (running) return;
        running = true;
        try {
            const now = new Date();
            
            // Fetch pending messages due for sending
            const pendingMessages = await prisma.scheduledMessage.findMany({
                where: {
                    status: "PENDING",
                    sendAt: {
                        lte: now
                    }
                },
                include: {
                    session: true
                }
            });

            if (pendingMessages.length === 0) return;

            // Only log if we're actually processing things to reduce noise
            logger.info("Cron", `Found ${pendingMessages.length} messages to send`);

            let batchCount = 0;
            for (const msg of pendingMessages) {
                const instance = waManager.getInstance(msg.session.sessionId);

                if (!instance || !instance.socket) {
                    logger.warn("Cron", `Session ${msg.session.sessionId} not connected. Skipping.`);
                    // Optionally mark as FAILED or retry later
                    // keeping PENDING will define behavior (retry next minute)
                    // But if session is dead for long time, it piles up.
                    // Let's keep it PENDING for now.
                    continue;
                }

                // Modo Seguro (só com o Anti-Spam ligado): fora do horário configurado, espera
                const safe = await getSafeMode(msg.session.sessionId);
                if (safe) {
                    const gate = safeGate(safe);
                    if (!gate.ok) continue; // continua PENDING e sai quando a janela abrir
                }

                try {
                    // Plano: conta suspensa ou sem cota não envia
                    try {
                        await assertCanSend(msg.session.userId, 1);
                    } catch (planErr: any) {
                        logger.warn("Cron", `Plano bloqueou o envio ${msg.id}: ${planErr.message}`);
                        if (!msg.cronExpression) {
                            await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { status: "FAILED" } });
                        } else {
                            const itv = cronParser.parse(msg.cronExpression, { tz: "America/Sao_Paulo" });
                            await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { sendAt: itv.next().toDate() } });
                        }
                        continue;
                    }

                    logger.info("Cron", `Sending to ${msg.jid}`);
                    
                    if (msg.mediaUrl) {
                        const type = msg.mediaType || "document";
                        const to = await resolveSendJid(instance.socket, msg.jid);
                        if (await isOptedOut(msg.session.sessionId, to)) throw new Error("Descadastrado (respondeu SAIR)");
                        if ((await onlyInteractedEnabled(msg.session.sessionId)) && !(await hasInteracted(msg.session.sessionId, to))) throw new Error(NO_INTERACTION_ERROR);
                        const media = await resolveMedia(msg.mediaUrl);
                        const src: any = media; // Buffer ou { url }
                        let payload: any = {};
                        if (msg.content) payload.caption = await personalizeFor(msg.session.sessionId, to, msg.content, [msg.jid]);

                        if (type === "image") {
                            payload.image = src;
                        } else if (type === "video") {
                            payload.video = src;
                        } else if (type === "audio") {
                            payload = { audio: src };
                        } else {
                            payload.document = src;
                            payload.mimetype = "application/octet-stream";
                            payload.fileName = msg.mediaUrl.split('/').pop() || "file";
                        }
                        await instance.socket.sendMessage(to, payload);
                    } else {
                        const to = await resolveSendJid(instance.socket, msg.jid);
                        if (await isOptedOut(msg.session.sessionId, to)) throw new Error("Descadastrado (respondeu SAIR)");
                        if ((await onlyInteractedEnabled(msg.session.sessionId)) && !(await hasInteracted(msg.session.sessionId, to))) throw new Error(NO_INTERACTION_ERROR);
                        await instance.socket.sendMessage(to, { text: msg.content ? await personalizeFor(msg.session.sessionId, to, msg.content, [msg.jid]) : "" });
                    }

                    await recordMessages(msg.session.userId, 1);

                    // Update status or compute next sendAt if recurring
                    if (msg.cronExpression) {
                        const interval = cronParser.parse(msg.cronExpression, { tz: "America/Sao_Paulo" });
                        const nextDate = interval.next().toDate();
                        await prisma.scheduledMessage.update({
                            where: { id: msg.id },
                            data: { sendAt: nextDate } // Keep status as PENDING
                        });
                    } else {
                        await prisma.scheduledMessage.update({
                            where: { id: msg.id },
                            data: { status: "SENT" }
                        });
                    }

                    if (safe) {
                        batchCount++;
                        if (safe.batchSize > 0 && batchCount % safe.batchSize === 0) await sleep(batchPauseMs(safe));
                        else await sleep(humanDelayMs(safe));
                    } else {
                        await sleep(2500 + Math.floor(Math.random() * 3500));
                    }
                } catch (error) {
                    logger.error("Cron", `Check failed for ${msg.id}`, error);
                    if (!msg.cronExpression) {
                        await prisma.scheduledMessage.update({
                            where: { id: msg.id },
                            data: { status: "FAILED" } // Failed to send
                        });
                    } else {
                        const interval = cronParser.parse(msg.cronExpression, { tz: "America/Sao_Paulo" });
                        await prisma.scheduledMessage.update({
                            where: { id: msg.id },
                            data: { sendAt: interval.next().toDate() }
                        });
                    }
                }
            }

        } catch (error) {
            logger.error("Cron", "Scheduler error:", error);
        } finally {
            running = false;
        }
    });
    
    startRetention();
    logger.info("Cron", "Scheduler initialized");
}
