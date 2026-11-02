import type { WASocket } from "@whiskeysockets/baileys";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { resolveToPhoneJid, telefoneDoLid } from "@/lib/jid-utils";

/**
 * Passa para o telefone as mensagens antigas guardadas sob um LID (a conversa "da cliente" separada da conversa
 * "da IA"). Só mexe quando o telefone é conhecido com certeza (agenda ou mapeamento do WhatsApp) e registra a
 * ligação no contato. Devolve quantos LIDs foram unificados.
 */
export async function unificarConversasLid(sock: WASocket, dbSessionId: string): Promise<number> {
    const lids = await prisma.message.groupBy({
        by: ["remoteJid"],
        where: { sessionId: dbSessionId, remoteJid: { endsWith: "@lid" } }
    });
    let unificados = 0;
    for (const { remoteJid: lid } of lids) {
        try {
            const telefone = await resolveToPhoneJid(lid, dbSessionId, null, (l) => telefoneDoLid(sock, l));
            if (telefone === lid) continue;
            await prisma.message.updateMany({ where: { sessionId: dbSessionId, remoteJid: lid }, data: { remoteJid: telefone } });
            await prisma.contact.upsert({
                where: { sessionId_jid: { sessionId: dbSessionId, jid: telefone } },
                create: { sessionId: dbSessionId, jid: telefone, lid },
                update: { lid }
            });
            unificados++;
        } catch (e) {
            logger.error("UnificarLid", `falha ao unificar ${lid}`, e);
        }
    }
    if (unificados > 0) logger.info("UnificarLid", `${unificados} conversa(s) do LID unificadas com o telefone`);
    return unificados;
}
