/**
 * Utilitários de telefone (seguros para usar no navegador e no servidor).
 */

/** Deixa só os dígitos e acrescenta o DDI 55 quando vier no formato brasileiro sem ele (10 ou 11 dígitos). */
export function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits;
}

/**
 * Converte um texto com vários números (um por linha, ou separados por vírgula/ponto e vírgula)
 * em uma lista de JIDs sem repetição. Aceita "(61) 99999-9999", "+55 61 99999-9999" e JIDs completos.
 */
export function parseRecipients(text: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of text.split(/[\n,;]+/)) {
        const t = part.trim();
        if (!t) continue;
        let jid: string;
        if (t.includes("@")) {
            jid = t;
        } else {
            const phone = normalizePhone(t);
            if (phone.length < 10 || phone.length > 15) continue;
            jid = `${phone}@s.whatsapp.net`;
        }
        if (!seen.has(jid)) {
            seen.add(jid);
            out.push(jid);
        }
    }
    return out;
}
