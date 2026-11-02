import { jidVariants } from "@/lib/phone";

/** Ids da tela "Conversas da IA": `ag:<id>` é conversa do agente de um negócio; sem prefixo, da atendente da API oficial. */
export const PREFIXO_AGENTE = "ag:";
/** Filtro da lista: `WA:<sessionId>` mostra as conversas do agente daquele número de WhatsApp. */
export const PREFIXO_NEGOCIO = "WA:";

/** Os JIDs onde as mensagens da conversa podem estar gravadas: o do chat (telefone ou LID), o telefone e a variante com/sem o 9º dígito. */
export function jidsDaConversa(c: { jid: string; telefone: string | null }): string[] {
    const jids = new Set<string>([c.jid]);
    for (const base of [c.jid, c.telefone ? `${c.telefone}@s.whatsapp.net` : null]) {
        if (base?.endsWith("@s.whatsapp.net")) for (const v of jidVariants(base)) jids.add(v);
    }
    if (c.telefone) jids.add(`${c.telefone}@s.whatsapp.net`);
    return [...jids];
}
