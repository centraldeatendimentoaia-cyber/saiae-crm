/** Tipos de correspondência aceitos pelas regras de resposta automática (tela, API e motor usam esta lista). */
export const MATCH_TYPES = ["EXACT", "CONTAINS", "STARTS_WITH", "REGEX"] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

/** Minúsculas, sem acento e com espaços colapsados: "  Olá   Tudo BEM " casa com "ola tudo bem". */
export function normalizarFrase(texto: string): string {
    return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Decide se a mensagem recebida aciona a regra. Regex inválida nunca casa. */
export function casaRegra(regra: { keyword: string; matchType: string }, texto: string): boolean {
    if (regra.matchType === "REGEX") {
        try {
            return new RegExp(regra.keyword, "i").test(texto);
        } catch {
            return false;
        }
    }
    const frase = normalizarFrase(regra.keyword);
    if (!frase) return false;
    const recebido = normalizarFrase(texto);
    switch (regra.matchType) {
        case "EXACT":
            return recebido === frase;
        case "STARTS_WITH":
            return recebido.startsWith(frase);
        case "CONTAINS":
            return recebido.includes(frase);
        default:
            return false;
    }
}
