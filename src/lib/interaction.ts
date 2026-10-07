import { prisma } from "@/lib/prisma";

export const NO_INTERACTION_ERROR = "Sem conversa anterior (modo: só quem já interagiu)";

/** O número está com "enviar só para quem já interagiu" ligado (Configurações do bot)? */
export async function onlyInteractedEnabled(sessionId: string): Promise<boolean> {
    const s = await prisma.session.findUnique({ where: { sessionId }, select: { botConfig: { select: { onlyInteracted: true } } } });
    return !!s?.botConfig?.onlyInteracted;
}

/** A pessoa já mandou alguma mensagem para este número? (vale mesmo depois de as mensagens antigas serem apagadas) */
export async function hasInteracted(sessionId: string, jid: string): Promise<boolean> {
    const s = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!s) return false;

    const contact = await prisma.contact.findFirst({
        where: { sessionId: s.id, OR: [{ jid }, { remoteJidAlt: jid }] },
        select: { jid: true, lid: true, lastInboundAt: true },
    });
    if (contact?.lastInboundAt) return true;

    const jids = [jid, contact?.jid, contact?.lid].filter((j): j is string => !!j);
    const m = await prisma.message.findFirst({ where: { sessionId: s.id, fromMe: false, remoteJid: { in: jids } }, select: { id: true } });
    return !!m;
}
