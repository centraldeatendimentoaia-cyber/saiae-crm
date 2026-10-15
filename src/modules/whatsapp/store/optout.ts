import type { WASocket } from "@whiskeysockets/baileys";
import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { addOptOut, removeOptOut, isOptOutText, isOptInText } from "@/lib/optout";
import { logger } from "@/lib/logger";

/** Quem responde SAIR (ou PARAR) deixa de receber disparos; VOLTAR desfaz. */
export function bindOptOut(sock: WASocket, sessionId: string) {
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        for (const msg of messages) {
            try {
                const jid = msg.key.remoteJid;
                if (!jid || msg.key.fromMe || jid.endsWith("@g.us") || jid.endsWith("@broadcast")) continue;
                const content = normalizeMessageContent(msg.message);
                const text = content?.conversation || content?.extendedTextMessage?.text || "";
                if (!text || text.length > 20) continue;

                const target = msg.key.remoteJidAlt || jid;
                if (isOptOutText(text)) {
                    await addOptOut(sessionId, target);
                    await sock.sendMessage(jid, { text: "Pronto, você não receberá mais mensagens de divulgação. Se mudar de ideia, responda VOLTAR." });
                    logger.info("OptOut", `${target} saiu da lista (${sessionId})`);
                } else if (isOptInText(text)) {
                    await removeOptOut(sessionId, target);
                    await sock.sendMessage(jid, { text: "Tudo certo, você voltou a receber nossas mensagens." });
                }
            } catch (e) {
                logger.error("OptOut", "Falha ao tratar descadastro:", e);
            }
        }
    });
}
