import { prisma } from "@/lib/prisma";
import { cancelarRunsDoContato } from "@/modules/automacoes/cancelamento";

/** Aviso opcional anexado aos disparos. */
export const OPTOUT_FOOTER = "Para não receber mais mensagens, responda SAIR.";

const letters = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z]/g, "").toUpperCase();

/** Últimos 8 dígitos do número: iguala as variações com e sem o 9º dígito. */
export function phoneKey(jid: string): string {
    const digits = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
    return digits.slice(-8);
}

/** O texto é um pedido de descadastro? ("SAIR", "sair.", "Sair!") */
export function isOptOutText(text: string): boolean {
    const t = letters(text);
    return t === "SAIR" || t === "PARAR";
}

export function isOptInText(text: string): boolean {
    return letters(text) === "VOLTAR";
}

export async function isOptedOut(sessionId: string, jid: string): Promise<boolean> {
    const key = phoneKey(jid);
    if (key.length < 8) return false;
    return !!(await prisma.optOut.findUnique({ where: { sessionId_phoneKey: { sessionId, phoneKey: key } }, select: { id: true } }));
}

export async function addOptOut(sessionId: string, jid: string): Promise<void> {
    const key = phoneKey(jid);
    if (key.length < 8) return;
    await prisma.optOut.upsert({
        where: { sessionId_phoneKey: { sessionId, phoneKey: key } },
        create: { sessionId, phoneKey: key, jid },
        update: {},
    });
    // Automações em andamento deste contato param já (o executor também reconfere antes de cada envio).
    // shortcut: casa pelo jid recebido; execução gravada com outra forma do mesmo número só cai na checagem do executor.
    await cancelarRunsDoContato(sessionId, jid, "optout").catch(() => {});
}

export async function removeOptOut(sessionId: string, jid: string): Promise<void> {
    await prisma.optOut.deleteMany({ where: { sessionId, phoneKey: phoneKey(jid) } });
}

/** Acrescenta o aviso de descadastro ao texto. */
export function withFooter(text: string): string {
    return text ? `${text}\n\n${OPTOUT_FOOTER}` : OPTOUT_FOOTER;
}
