import crypto from "crypto";

/** Tolerância entre o relógio da Comanda e o do CRM (contrato: 5 minutos). */
export const MAX_SKEW_SECONDS = 5 * 60;

/** Cabeçalho X-Saiae-Timestamp: epoch em segundos, só dígitos. Devolve null se inválido. */
export function parseTimestamp(header: string | null): number | null {
    if (!header || !/^\d{1,12}$/.test(header.trim())) return null;
    return Number(header.trim());
}

export function timestampInWindow(ts: number, nowMs: number = Date.now()): boolean {
    return Math.abs(nowMs / 1000 - ts) <= MAX_SKEW_SECONDS;
}

/**
 * X-Saiae-Signature = "sha256=" + HMAC-SHA256(segredo, timestamp + "." + corpo bruto), em hex.
 * Compara em tempo constante e aceita mais de um segredo (rotação: o antigo e o novo valem juntos).
 */
export function verifyComandaSignature(rawBody: Buffer, timestamp: string, header: string | null, secrets: string[]): boolean {
    if (!header || secrets.length === 0) return false;
    const m = /^sha256=([0-9a-fA-F]{64})$/.exec(header.trim());
    if (!m) return false;
    const received = Buffer.from(m[1], "hex");
    const signed = Buffer.concat([Buffer.from(`${timestamp.trim()}.`, "utf8"), rawBody]);
    let ok = false;
    for (const secret of secrets) {
        const expected = crypto.createHmac("sha256", secret).update(signed).digest();
        // não interrompe no primeiro acerto: o tempo não revela qual segredo bateu
        if (crypto.timingSafeEqual(received, expected)) ok = true;
    }
    return ok;
}
