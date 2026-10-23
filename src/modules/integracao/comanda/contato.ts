/** Telefone e nome da barraca a partir do evento da Comanda (funções puras, sem dependências). */

/**
 * Nome da barraca para o {{3}}. Ordem: `data.barraca_nome` do evento (campo aditivo do contrato, quando a Comanda
 * passar a enviar), depois o env COMANDA_BARRACA_NOMES='{"<barraca_id>":"Açaí do Didi"}' (reserva), depois "a loja".
 */
export function barracaName(barracaId: string, env: Record<string, string | undefined> = process.env, fromEvent?: unknown): string {
    const fromData = typeof fromEvent === "string" ? fromEvent.replace(/\s+/g, " ").trim() : "";
    if (fromData) return fromData.slice(0, 60);
    try {
        const map = JSON.parse(env.COMANDA_BARRACA_NOMES ?? "{}") as Record<string, unknown>;
        const name = map[barracaId];
        if (typeof name === "string" && name.trim()) return name.trim().slice(0, 60);
    } catch {
        /* variável inválida: usa o padrão */
    }
    return "a loja";
}

/**
 * Telefone do contrato = NACIONAL (a Comanda manda sem o país, ex. 61999990001), com ou sem 55 e com ou sem
 * máscara. Devolve E.164 brasileiro só com dígitos (5561999990001), ou null se não der para ter certeza:
 *   10 ou 11 dígitos              → prefixa 55
 *   12 ou 13 dígitos começando 55 → mantém
 *   qualquer outro tamanho (ex. 9 dígitos, BSUID, número estrangeiro) → null (não envia)
 */
export function normalizeBrPhone(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    if (/[A-Za-z]/.test(raw)) return null; // BSUID (ex.: BR.123...) e texto com letras não são telefone
    const d = raw.replace(/\D/g, "");
    if (d.length === 10 || d.length === 11) return "55" + d;
    if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
    return null;
}
