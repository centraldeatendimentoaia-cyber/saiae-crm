import crypto from "crypto";
import { z } from "zod";
import { logger as defaultLogger } from "@/lib/logger";
import { BoundedTtlMap } from "@/modules/integracao/comanda/state";

/**
 * Cliente do contexto da Comanda (contrato SAI-002, `ia-contexto`): dá à IA os dados REAIS da loja e, se o
 * telefone for de um cliente com perfil confirmado, o primeiro nome e os itens dos últimos pedidos.
 * Somente leitura. Contrato: docs do repositório da Comanda (docs/contrato/v1/ia-contexto.md).
 *
 * Assinatura: `X-Saiae-Signature = "sha256=" + HMAC-SHA256(COMANDA_IA_SEGREDO, timestamp + "." + corpo)`.
 * Qualquer falha (rede, timeout, 4xx/5xx, resposta fora de forma) vira `{ ativa: false }`: a IA fica calada
 * em vez de inventar. O log nunca inclui telefone, corpo, nem a mensagem do erro.
 */

const TEXTO = (max: number) => z.string().transform((s) => s.slice(0, max));
const CENTAVOS = z.number().int().min(0);

const opcao = z.object({ nome: TEXTO(120), preco_centavos: CENTAVOS });
const adicional = z.object({
    grupo: TEXTO(120),
    tipo: z.enum(["variacao", "adicional"]).default("adicional"),
    obrigatorio: z.boolean(),
    opcoes: z.array(opcao).max(50),
});
const item = z.object({
    nome: TEXTO(160),
    descricao: TEXTO(500).nullable(),
    categoria: TEXTO(120),
    preco_centavos: CENTAVOS,
    esgotado: z.boolean(),
    adicionais: z.array(adicional).max(20),
});

const ativaSchema = z.object({
    ativa: z.literal(true),
    loja: z.object({
        nome: TEXTO(160),
        endereco: TEXTO(300).nullable(),
        aberta_agora: z.boolean().nullable(),
        horarios: z.array(z.object({ dia: z.number().int().min(0).max(6), aberto: z.boolean(), abre: z.string().nullable(), fecha: z.string().nullable() })).max(14),
        modos: z.array(z.string()).max(10),
        pagamentos: z.array(z.string()).max(20),
        taxa_entrega: z.object({
            habilitada: z.boolean(),
            padrao_centavos: CENTAVOS.nullable(),
            bairro_nao_listado: z.enum(["taxa_padrao", "bloquear"]).default("taxa_padrao"),
            bairros: z.array(z.object({ bairro: TEXTO(120), taxa_centavos: CENTAVOS })).max(300),
        }),
        link_cardapio: z.string().url().max(300),
    }),
    cardapio: z.object({ truncado: z.boolean(), itens: z.array(item).max(200) }),
    cliente: z.object({ primeiro_nome: TEXTO(60), ultimos_pedidos: z.array(z.object({ itens: z.array(TEXTO(160)).max(30) })).max(3) }).nullable(),
    ia: z.object({
        texto_livre: TEXTO(2000).nullable(),
        whatsapp_dono: z.string().nullable(),
        plano_limite_conversas: z.number().int().min(0).nullable(),
    }),
});

const respostaSchema = z.union([z.object({ ativa: z.literal(false) }), ativaSchema]);

export type IaContextoAtivo = z.infer<typeof ativaSchema>;
export type IaContexto = { ativa: false } | IaContextoAtivo;

export const INATIVA: IaContexto = { ativa: false };
export const TIMEOUT_MS = 8_000;
export const CACHE_TTL_MS = 60_000;

const CODIGO_LOJA = /^[A-Z0-9]{6}$/;

export interface ContextoDeps {
    fetch: typeof fetch;
    env: Record<string, string | undefined>;
    now: () => number;
    logger: { warn: (tag: string, msg: string) => void };
    cache: BoundedTtlMap<IaContexto>;
}

const cachePadrao = new BoundedTtlMap<IaContexto>(2_000, CACHE_TTL_MS);

const TAG = "IaContexto";

export function assinar(segredo: string, timestamp: string, corpo: string): string {
    return "sha256=" + crypto.createHmac("sha256", segredo).update(`${timestamp}.${corpo}`).digest("hex");
}

/**
 * Busca o contexto da loja para este cliente. `telefone`: só dígitos (10 a 13). Nunca lança.
 * Sem COMANDA_IA_SEGREDO/COMANDA_IA_URL, código de loja inválido ou telefone inválido (ex.: BSUID): `{ ativa: false }`
 * sem chamar a Comanda.
 */
export async function buscarContexto(codigoLoja: string, telefone: string, over: Partial<ContextoDeps> = {}): Promise<IaContexto> {
    const deps: ContextoDeps = { fetch: globalThis.fetch, env: process.env, now: Date.now, logger: defaultLogger, cache: cachePadrao, ...over };

    const segredo = deps.env.COMANDA_IA_SEGREDO?.trim();
    const url = deps.env.COMANDA_IA_URL?.trim();
    if (!segredo || !url) {
        deps.logger.warn(TAG, "COMANDA_IA_SEGREDO ou COMANDA_IA_URL ausente");
        return INATIVA;
    }
    if (!CODIGO_LOJA.test(codigoLoja)) return INATIVA;
    const digitos = typeof telefone === "string" ? telefone.replace(/\D/g, "") : "";
    if (!/^[0-9]{10,13}$/.test(digitos) || /[A-Za-z]/.test(telefone)) return INATIVA;

    const chave = `${codigoLoja}:${digitos}`;
    const guardado = deps.cache.get(chave);
    if (guardado) return guardado;

    const corpo = JSON.stringify({ codigo_loja: codigoLoja, telefone: digitos });
    const timestamp = String(Math.floor(deps.now() / 1000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await deps.fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Saiae-Timestamp": timestamp, "X-Saiae-Signature": assinar(segredo, timestamp, corpo) },
            body: corpo,
            signal: controller.signal,
        });
        if (!res.ok) {
            deps.logger.warn(TAG, `Comanda respondeu HTTP ${res.status}`);
            return INATIVA; // falha: não guarda em cache (pode ser passageira)
        }
        const parsed = respostaSchema.safeParse(await res.json());
        if (!parsed.success) {
            deps.logger.warn(TAG, "resposta da Comanda fora do contrato");
            return INATIVA;
        }
        deps.cache.set(chave, parsed.data);
        return parsed.data;
    } catch (e) {
        const aborted = (e as { name?: string })?.name === "AbortError";
        deps.logger.warn(TAG, aborted ? "tempo esgotado falando com a Comanda" : "falha de rede falando com a Comanda");
        return INATIVA;
    } finally {
        clearTimeout(timer);
    }
}

/** Só para testes. */
export const limparCacheContextoParaTeste = () => cachePadrao.clear();
