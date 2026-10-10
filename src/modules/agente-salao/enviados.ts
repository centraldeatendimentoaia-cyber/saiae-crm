/**
 * IDs das mensagens que o próprio CRM enviou por uma sessão (IA, disparo, agendador, API). Quando o WhatsApp devolve uma
 * mensagem "fromMe" cujo ID não está aqui, foi uma pessoa escrevendo pelo celular ou pelo WhatsApp Web: o agente se cala.
 * Fica na memória do servidor (vale por alguns minutos; um reinício só afeta mensagens do instante exato do reinício).
 */
const TTL_MS = 10 * 60_000;
const MAX = 5000;
const ids = new Map<string, number>();

export function marcarEnviadaPeloCrm(id: string, agora = Date.now()): void {
    ids.set(id, agora + TTL_MS);
    if (ids.size > MAX) limpar(agora);
}

export function foiEnviadaPeloCrm(id: string | null | undefined, agora = Date.now()): boolean {
    if (!id) return false;
    const ate = ids.get(id);
    if (ate === undefined) return false;
    if (ate < agora) {
        ids.delete(id);
        return false;
    }
    return true;
}

function limpar(agora: number): void {
    for (const [k, ate] of ids) if (ate < agora) ids.delete(k);
    if (ids.size > MAX) for (const k of [...ids.keys()].slice(0, ids.size - MAX)) ids.delete(k);
}

/** Só para testes. */
export function _zerarEnviados(): void {
    ids.clear();
}
