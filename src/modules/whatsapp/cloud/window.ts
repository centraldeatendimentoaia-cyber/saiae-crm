/**
 * Janela de atendimento de 24 h da WhatsApp Cloud API.
 *
 * Texto livre e mídia só podem ser enviados dentro de 24 h da ÚLTIMA mensagem que o cliente mandou.
 * Fora disso, só template aprovado. Como a Meta cobra e recusa o envio fora da janela, o provedor
 * confere antes e nem chama a Meta.
 */

export const WINDOW_HOURS = 24;
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;

/** Onde o provedor descobre quando o cliente escreveu pela última vez. */
export interface WindowStore {
    lastInboundAt(sessionId: string, contactKey: string): Promise<Date | null>;
}

export function isWindowOpen(lastInboundAt: Date | null, now: Date = new Date()): boolean {
    if (!lastInboundAt) return false;
    const age = now.getTime() - lastInboundAt.getTime();
    // mensagem "do futuro" (relógio dessincronizado) não abre janela: trata como inválida
    return age >= 0 && age < WINDOW_MS;
}

/** Implementação em memória, para testes e desenvolvimento. */
export class InMemoryWindowStore implements WindowStore {
    private readonly map = new Map<string, Date>();

    record(sessionId: string, contactKey: string, at: Date): void {
        const k = `${sessionId}:${contactKey}`;
        const prev = this.map.get(k);
        if (!prev || at > prev) this.map.set(k, at);
    }

    async lastInboundAt(sessionId: string, contactKey: string): Promise<Date | null> {
        return this.map.get(`${sessionId}:${contactKey}`) ?? null;
    }
}
