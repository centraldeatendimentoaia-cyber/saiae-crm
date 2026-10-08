/**
 * Segredos por barraca, só por variável de ambiente (nada no banco, nada no repositório):
 *
 *   COMANDA_WEBHOOK_SECRETS='{"<barraca_id>":"<segredo>","<outra_barraca>":["<novo>","<antigo>"]}'
 *
 * O valor pode ser um texto ou uma lista (rotação: durante a troca, o segredo novo e o antigo valem).
 * Devolve null se a variável não existe, não é um JSON de objeto ou não tem nenhuma barraca válida:
 * a rota responde 503 (não configurado), nunca aceita sem segredo.
 */
export type SecretsMap = Map<string, string[]>;

let cacheKey: string | undefined;
let cacheValue: SecretsMap | null = null;

export function loadSecrets(env: Record<string, string | undefined> = process.env): SecretsMap | null {
    const raw = env.COMANDA_WEBHOOK_SECRETS;
    if (raw === cacheKey) return cacheValue;
    cacheKey = raw;
    cacheValue = parse(raw);
    return cacheValue;
}

function parse(raw: string | undefined): SecretsMap | null {
    if (!raw || !raw.trim()) return null;
    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch {
        return null;
    }
    if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
    const map: SecretsMap = new Map();
    for (const [barraca, value] of Object.entries(json as Record<string, unknown>)) {
        const list = (Array.isArray(value) ? value : [value]).filter((s): s is string => typeof s === "string" && s.length >= 16);
        if (list.length > 0) map.set(barraca, list);
    }
    return map.size > 0 ? map : null;
}
