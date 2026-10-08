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
 * Chave para reconhecer a mesma pessoa escrita de jeitos diferentes: números brasileiros com e sem o 9º dígito
 * (556199531848 e 5561999531848) viram a mesma chave. Aceita telefone ou JID.
 */
export function canonicalPhone(raw: string): string {
    let d = raw.split("@")[0].split(":")[0].replace(/\D/g, "");
    if (d.startsWith("55") && d.length === 13 && d[4] === "9") d = d.slice(0, 4) + d.slice(5);
    return d;
}

/** Os dois formatos possíveis do mesmo número brasileiro (com e sem o 9º dígito), como JIDs. */
export function jidVariants(jid: string): string[] {
    const d = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
    const out = new Set<string>([`${d}@s.whatsapp.net`]);
    if (d.startsWith("55") && d.length === 13 && d[4] === "9") out.add(`${d.slice(0, 4)}${d.slice(5)}@s.whatsapp.net`);
    if (d.startsWith("55") && d.length === 12) out.add(`${d.slice(0, 4)}9${d.slice(4)}@s.whatsapp.net`);
    return Array.from(out);
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
        const key = jid.includes("@s.whatsapp.net") ? canonicalPhone(jid) : jid;
        if (!seen.has(key)) {
            seen.add(key);
            out.push(jid);
        }
    }
    return out;
}
