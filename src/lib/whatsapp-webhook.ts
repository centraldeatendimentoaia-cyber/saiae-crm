import crypto from "crypto";

/**
 * Utilidades do webhook da WhatsApp Cloud API (Meta).
 * Nada aqui lê nem devolve conteúdo de mensagem ou telefone: só tipo e contagem.
 */

/** Comparação em tempo constante de textos de qualquer tamanho (compara os hashes, não os textos). */
export function safeEqual(a: string, b: string): boolean {
    const ha = crypto.createHash("sha256").update(a, "utf8").digest();
    const hb = crypto.createHash("sha256").update(b, "utf8").digest();
    return crypto.timingSafeEqual(ha, hb);
}

/**
 * Valida o cabeçalho X-Hub-Signature-256 ("sha256=<hex>"): HMAC-SHA256 do corpo BRUTO
 * (bytes exatos recebidos) com o App Secret do aplicativo da Meta.
 */
export function verifyMetaSignature(rawBody: Buffer, header: string | null, appSecret: string): boolean {
    if (!header || !appSecret) return false;
    const m = /^sha256=([0-9a-fA-F]{64})$/.exec(header.trim());
    if (!m) return false;
    const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest();
    const received = Buffer.from(m[1], "hex");
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

export interface EventSummary {
    object: string;
    entries: number;
    changes: Record<string, number>; // contagem por campo (ex.: messages)
    messages: number;
    statuses: number;
}

/** Resumo só com tipos e contagens, seguro para log. Aceita qualquer JSON sem lançar erro. */
export function summarizeEvent(payload: unknown): EventSummary {
    const summary: EventSummary = { object: "desconhecido", entries: 0, changes: {}, messages: 0, statuses: 0 };
    if (!payload || typeof payload !== "object") return summary;
    const p = payload as { object?: unknown; entry?: unknown };
    if (typeof p.object === "string") summary.object = p.object.slice(0, 64);
    if (!Array.isArray(p.entry)) return summary;
    summary.entries = p.entry.length;
    for (const entry of p.entry) {
        const changes = (entry as { changes?: unknown })?.changes;
        if (!Array.isArray(changes)) continue;
        for (const change of changes) {
            const field = typeof (change as { field?: unknown })?.field === "string" ? (change as { field: string }).field.slice(0, 64) : "desconhecido";
            summary.changes[field] = (summary.changes[field] ?? 0) + 1;
            const value = (change as { value?: { messages?: unknown; statuses?: unknown } })?.value;
            if (Array.isArray(value?.messages)) summary.messages += value.messages.length;
            if (Array.isArray(value?.statuses)) summary.statuses += value.statuses.length;
        }
    }
    return summary;
}
