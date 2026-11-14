import { cloudSessionIds } from "./index";

/**
 * Qual sessão Cloud atende um evento. Substitui o antigo `[...cloudSessionIds(env)][0]`, que escolhia a primeira
 * sessão da lista mesmo com várias lojas (mensagem e aviso de uma loja saíam pela sessão de outra).
 *
 * Mapas opcionais, em variáveis de ambiente (JSON, sem banco):
 *   WHATSAPP_CLOUD_PHONE_MAP    {"<phone_number_id da Meta>": "<sessionId>"}
 *   WHATSAPP_CLOUD_BARRACA_MAP  {"<barraca_id da Comanda>": "<sessionId>"}
 *
 * Regra: com EXATAMENTE uma sessão Cloud o comportamento é o de sempre (essa sessão, sem mapa). Com mais de uma,
 * só resolve quando o mapa aponta para uma sessão listada; senão devolve `ok: false` com o motivo, e quem chamou
 * registra e não envia nada. Nunca escolhe ao acaso.
 */
export type MotivoSemSessao = "sem_sessao_cloud" | "ambigua" | "sem_correspondencia";
export type ResolucaoCloud = { ok: true; sessionId: string } | { ok: false; motivo: MotivoSemSessao };

type Env = Record<string, string | undefined>;

function lerMapa(env: Env, chave: string): Map<string, string> {
    try {
        const bruto = JSON.parse(env[chave] ?? "{}") as unknown;
        if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return new Map();
        return new Map(Object.entries(bruto).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== "").map(([k, v]) => [k, v.trim()]));
    } catch {
        return new Map(); // mapa quebrado = sem mapa (com várias sessões isso falha fechado como "ambigua")
    }
}

function resolver(env: Env, mapa: Map<string, string>, chave: string | null | undefined): ResolucaoCloud {
    const ids = cloudSessionIds(env);
    if (ids.size === 0) return { ok: false, motivo: "sem_sessao_cloud" };
    const alvo = chave ? mapa.get(chave) : undefined;
    if (alvo) return ids.has(alvo) ? { ok: true, sessionId: alvo } : { ok: false, motivo: "sem_correspondencia" };
    if (ids.size === 1 && mapa.size === 0) return { ok: true, sessionId: [...ids][0] };
    return { ok: false, motivo: ids.size === 1 ? "sem_correspondencia" : "ambigua" };
}

/** Sessão dona de um número (phone_number_id do webhook ou do envio). */
export const sessaoDoNumero = (env: Env, phoneNumberId: string | null | undefined): ResolucaoCloud =>
    resolver(env, lerMapa(env, "WHATSAPP_CLOUD_PHONE_MAP"), phoneNumberId);

/** Sessão dona de uma barraca (aviso de pedido). */
export const sessaoDaBarracaCloud = (env: Env, barracaId: string): ResolucaoCloud =>
    resolver(env, lerMapa(env, "WHATSAPP_CLOUD_BARRACA_MAP"), barracaId);

/**
 * O número que ENVIA é um só (META_WA_PHONE_NUMBER_ID). Com mais de uma sessão Cloud, só envia pela sessão `esperada`
 * se esse número pertence a ela; senão a mensagem sairia pelo número de outra loja.
 */
export function numeroDeEnvioPertence(env: Env, esperada: string): boolean {
    if (cloudSessionIds(env).size <= 1) return true;
    const r = sessaoDoNumero(env, env.META_WA_PHONE_NUMBER_ID?.trim());
    return r.ok && r.sessionId === esperada;
}
