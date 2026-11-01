import { errorMessage } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { AnyMessageContent, WASocket } from "@whiskeysockets/baileys";
import type { BotConfig } from "@prisma/client";
import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { logger } from "@/lib/logger";
import { casaRegra } from "./autoreply-match";
import { marcarRespondidaPorRegra } from "@/modules/agente-salao/enviados";

// Helper for permission check (Deduplicate from command-handler if possible, but keep simple here)
export function canAutoReply(config: BotConfig | null | undefined, fromMe: boolean, senderJid: string): boolean {
    if (!config || !config.enabled) return false;

    // Auto Reply Specific Mode
    const mode = config.autoReplyMode || 'ALL';

    if (fromMe) {
        // If mode is OWNER, it triggers for ME? 
        // Auto Reply usually replies TO someone. 
        // If I send a message, and mode is OWNER, should it reply to me? 
        // User requested "Self Mode" -> Use case: Snippets.
        // So yes, if fromMe checks out.

        // However, standard auto-reply logic (replying to incoming) should be blocked if fromMe is true AND mode is ALL?
        // No, typically Auto Reply doesn't trigger on own messages to prevent unexpected loops.
        // But for "Self Mode" (Macros), it MUST trigger on own messages.

        if (mode === 'OWNER') return true;
        if (mode === 'ALL') return false; // Standard auto-reply ignores self

        // Specific? 
        return false;
    } else {
        // Incoming message from others
        if (mode === 'OWNER') return false; // Owner only acts on Owner messages
        if (mode === 'ALL') return true;

        if (mode === 'SPECIFIC') {
            const allowedJids = config.autoReplyAllowedJids || [];
            if (Array.isArray(allowedJids)) {
                return allowedJids.some((jid) => typeof jid === "string" && senderJid.includes(jid));
            }
        }

        if (mode === 'BLACKLIST') {
            const blockedJids = config.autoReplyBlockedJids || [];
            if (Array.isArray(blockedJids)) {
                const isBlocked = blockedJids.some((jid) => typeof jid === "string" && senderJid.includes(jid));
                return !isBlocked; // Return true if NOT blocked
            }
            return true; // If blacklist empty, allow all
        }
    }

    return false;
}

const jaLigado = new WeakSet<object>();

export async function bindAutoReply(sock: WASocket, sessionId: string) {
    // um segundo "connection: open" no mesmo socket não pode somar outro ouvinte (a resposta sairia em dobro)
    if (jaLigado.has(sock)) return;
    jaLigado.add(sock);
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        // Fetch session ID and Bot Config once per batch (optimization)
        const session = await prisma.session.findUnique({
            where: { sessionId },
            include: { botConfig: true }
        });

        if (!session) return;

        let config = session.botConfig;

        if (!config) {
            logger.warn("AutoReply", "No config found, creating default...");
            config = await prisma.botConfig.create({
                data: {
                    sessionId: session.id,
                    enabled: true,
                    botMode: 'OWNER',
                    autoReplyMode: 'ALL'
                }
            });
        }

        logger.debug("AutoReply", `Processing for ${sessionId}. Config: ${config ? "Found" : "Missing"}, ${config?.enabled ? "Enabled" : "Disabled"}`);

        if (!config || !config.enabled) return;

        for (const msg of messages) {
            const fromMe = msg.key.fromMe || false;
            const remoteJid = msg.key.remoteJid;

            // Standardized Sender Logic
            const isGroup = remoteJid?.endsWith("@g.us") || false;
            const remoteJidAlt = msg.key.remoteJidAlt;
            let senderJid = (isGroup ? (msg.key.participant || msg.participant) : remoteJid);

            if (!isGroup && remoteJidAlt) {
                senderJid = remoteJidAlt;
            }

            if (!remoteJid || !senderJid) continue;

            // Check Permissions
            if (!canAutoReply(config, fromMe, senderJid)) continue;

            const content = normalizeMessageContent(msg.message);
            const text = content?.conversation || content?.extendedTextMessage?.text || ""; // Caption?

            if (!text) continue;

            try {
                // Fetch rules for this session
                const rules = await prisma.autoReply.findMany({
                    where: {
                        session: {
                            sessionId: sessionId
                        }
                    }
                });

                for (const rule of rules) {
                    if (casaRegra(rule, text)) {
                        // Check trigger context (GROUP, PRIVATE, or ALL)
                        const isGroup = remoteJid.endsWith('@g.us');
                        const triggerType = rule.triggerType || 'ALL'; // Default to ALL if undefined

                        if (triggerType === 'GROUP' && !isGroup) continue;
                        if (triggerType === 'PRIVATE' && isGroup) continue;

                        logger.info("AutoReply", `Match: ${rule.keyword} -> ${remoteJid}`);

                        if (rule.isMedia && rule.mediaUrl) {
                            const url = rule.mediaUrl;
                            const type = rule.mediaType || "document";
                            
                            const caption = rule.response || undefined;
                            let payload: AnyMessageContent;
                            if (type === "image") {
                                payload = { image: { url }, caption };
                            } else if (type === "video") {
                                payload = { video: { url }, caption };
                            } else if (type === "audio") {
                                payload = { audio: { url } };
                            } else {
                                payload = { document: { url }, caption, mimetype: 'application/octet-stream', fileName: url.split('/').pop() || 'document' };
                            }
                            
                            try {
                                await sock.sendMessage(remoteJid, payload, { quoted: msg });
                            } catch (err) {
                                logger.error("AutoReply", `Failed to send media auto-reply from URL: ${errorMessage(err)}. Falling back to text if response exists.`);
                                if (rule.response) {
                                    await sock.sendMessage(remoteJid, { text: rule.response }, { quoted: msg });
                                }
                            }
                        } else if (rule.response) {
                            await sock.sendMessage(remoteJid, { text: rule.response }, { quoted: msg });
                        }

                        marcarRespondidaPorRegra(msg.key.id); // o agente de IA não responde de novo a esta mensagem
                        break;
                    }
                }

            } catch (e) {
                logger.error("AutoReply", "Error executing auto-reply", e);
            }
        }
    });
}
