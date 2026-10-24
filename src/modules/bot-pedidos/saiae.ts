import { z } from "zod";
import { logger as defaultLogger } from "@/lib/logger";
import { BoundedTtlMap } from "@/modules/integracao/comanda/state";
import { assinar } from "@/modules/ia-atendimento/comanda-contexto";
import { segredosWhatsapp } from "@/modules/integracao/comanda/sessao-evento";

/**
 * Cliente da edge function `integracao-v1` do Sai aê (contrato fixo no plano whatsapp-bot-fase2): POST assinado com o
 * segredo de plataforma (mesmo de COMANDA_WHATSAPP_SEGREDO = WHATSAPP_CONEXAO_SEGREDO no Sai aê). Nunca lança: qualquer
 * falha vira `{ ok:false, codigo }`. O log nunca leva telefone, itens, nem o corpo.
 */

export type AcaoSaiae = "cardapio" | "rascunho" | "pedido" | "pix";
export type RespostaSaiae = { ok: true; [k: string]: unknown } | { ok: false; codigo: string; mensagem?: string; erros?: unknown };

export const TIMEOUT_MS = 8_000;
export const CACHE_CARDAPIO_MS = 60_000;
const TAG = "BotSaiae";

const opcaoSchema = z.object({ opcao_id: z.string(), nome: z.string(), preco_adicional_centavos: z.number().optional() });
const grupoSchema = z.object({ grupo_id: z.string(), nome: z.string(), minimo: z.number().optional(), maximo: z.number().optional(), opcoes: z.array(opcaoSchema) });
export const itemCardapioSchema = z.object({
    item_id: z.string(),
    nome: z.string(),
    descricao: z.string().nullable().optional(),
    categoria: z.string().nullable().optional(),
    esgotado: z.boolean().optional(),
    grupos: z.array(grupoSchema).default([]),
});
export const cardapioSchema = z.object({
    ok: z.literal(true),
    loja: z.object({
        nome: z.string(),
        link_cardapio: z.string().url(),
        aberta_agora: z.boolean(),
        modos: z.array(z.string()),
        pagamentos: z.object({ na_entrega: z.boolean(), pix: z.boolean() }),
        whatsapp_dono: z.string().nullable(),
        bot_habilitado: z.boolean(),
    }),
    itens: z.array(itemCardapioSchema).max(500),
});
export type Cardapio = z.infer<typeof cardapioSchema>;

export interface DepsSaiae {
    fetch: typeof fetch;
    env: Record<string, string | undefined>;
    now: () => number;
    logger: { warn: (tag: string, msg: string) => void };
    cache: BoundedTtlMap<Cardapio>;
}

const cachePadrao = new BoundedTtlMap<Cardapio>(500, CACHE_CARDAPIO_MS);

export async function chamarSaiae(acao: AcaoSaiae, barracaId: string, corpo: Record<string, unknown> = {}, over: Partial<DepsSaiae> = {}): Promise<RespostaSaiae> {
    const deps: DepsSaiae = { fetch: globalThis.fetch, env: process.env, now: Date.now, logger: defaultLogger, cache: cachePadrao, ...over };
    const url = deps.env.SAIAE_INTEGRACAO_V1_URL?.trim();
    const segredo = segredosWhatsapp(deps.env)[0];
    if (!url || !segredo) return { ok: false, codigo: "nao_configurado" };

    if (acao === "cardapio") {
        const guardado = deps.cache.get(barracaId);
        if (guardado) return guardado;
    }

    const texto = JSON.stringify({ ...corpo, barraca_id: barracaId, acao });
    const timestamp = String(Math.floor(deps.now() / 1000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await deps.fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Saiae-Timestamp": timestamp, "X-Saiae-Signature": assinar(segredo, timestamp, texto) },
            body: texto,
            signal: controller.signal,
        });
        if (!res.ok) {
            deps.logger.warn(TAG, `${acao}: Sai aê respondeu HTTP ${res.status}`);
            return { ok: false, codigo: "indisponivel" };
        }
        const json = (await res.json()) as unknown;
        if (acao === "cardapio") {
            const p = cardapioSchema.safeParse(json);
            if (!p.success) {
                // recusa de negócio do cardápio (ok:false) também chega aqui
                const codigo = (json as { codigo?: unknown })?.codigo;
                deps.logger.warn(TAG, "cardapio: resposta fora do contrato ou recusada");
                return { ok: false, codigo: typeof codigo === "string" ? codigo : "resposta_invalida" };
            }
            deps.cache.set(barracaId, p.data);
            return p.data;
        }
        if (!json || typeof json !== "object" || typeof (json as { ok?: unknown }).ok !== "boolean") {
            deps.logger.warn(TAG, `${acao}: resposta fora do contrato`);
            return { ok: false, codigo: "resposta_invalida" };
        }
        return json as RespostaSaiae;
    } catch (e) {
        deps.logger.warn(TAG, `${acao}: ${(e as { name?: string })?.name === "AbortError" ? "tempo esgotado" : "falha de rede"}`);
        return { ok: false, codigo: "indisponivel" };
    } finally {
        clearTimeout(timer);
    }
}

export const limparCacheSaiaeParaTeste = () => cachePadrao.clear();
