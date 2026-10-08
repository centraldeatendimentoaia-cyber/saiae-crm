import { logger as defaultLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { BoundedTtlMap } from "@/modules/integracao/comanda/state";
import type { IaContextoAtivo } from "./comanda-contexto";
import type { ConversaRef } from "./store";

/**
 * Consumo mensal da IA: uma "conversa" = um cliente (telefone) numa loja, dentro de uma janela de 24 h, contada no mês de
 * São Paulo (tabela IaConsumo). O limite do plano vem de `plano_limite_conversas` do contexto da Comanda (mesma fonte
 * da tela do dono). Passou do limite: a IA só manda o link do cardápio e o dono é avisado UMA vez no mês.
 *
 * Aproximações assumidas na fase 1 (documentadas em docs/IA_ATENDIMENTO.md): o "último limite visto" e o aviso de
 * "já avisei este mês" ficam em memória (somem se o serviço reiniciar); conversas que já estavam em andamento quando o
 * contador passa do limite também caem no modo "só link". Falha ao contar nunca silencia a IA (segue como "ok").
 */

export type DecisaoLimite = "ok" | "so_link";

export interface ConsumoStore {
    /** true se esta é a primeira mensagem do cliente nas últimas 24 h desta conversa (a mensagem atual já está gravada). */
    conversaNova(conversa: ConversaRef, agora: Date): Promise<boolean>;
    incrementar(lojaCodigo: string, mes: string): Promise<number>;
    ler(lojaCodigo: string, mes: string): Promise<number>;
}

/** "AAAA-MM" no fuso de São Paulo. */
export function mesSaoPaulo(d: Date): string {
    const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(d);
    const ano = partes.find((p) => p.type === "year")?.value;
    const mes = partes.find((p) => p.type === "month")?.value;
    return `${ano}-${mes}`;
}

export const prismaConsumo: ConsumoStore = {
    async conversaNova(conversa, agora) {
        const n = await prisma.iaMensagem.count({ where: { conversaId: conversa.id, direcao: "in", criadoEm: { gte: new Date(agora.getTime() - 24 * 3_600_000) } } });
        return n <= 1;
    },
    async incrementar(lojaCodigo, mes) {
        const r = await prisma.iaConsumo.upsert({
            where: { lojaCodigo_mes: { lojaCodigo, mes } },
            create: { lojaCodigo, mes, conversas: 1 },
            update: { conversas: { increment: 1 } },
            select: { conversas: true },
        });
        return r.conversas;
    },
    async ler(lojaCodigo, mes) {
        const r = await prisma.iaConsumo.findUnique({ where: { lojaCodigo_mes: { lojaCodigo, mes } }, select: { conversas: true } });
        return r?.conversas ?? 0;
    },
};

/** Último `plano_limite_conversas` visto por loja (memória). Alimenta o campo `limite` da rota de consumo. */
const ultimoLimite = new BoundedTtlMap<{ limite: number | null }>(5_000, 7 * 24 * 3_600_000);
export const limiteConhecido = (lojaCodigo: string): number | null => ultimoLimite.get(lojaCodigo)?.limite ?? null;
export const limparLimitesParaTeste = () => ultimoLimite.clear();

export interface ControleLimiteDeps {
    store: ConsumoStore;
    /** Avisa o responsável que o limite do mês acabou (chamado no máximo uma vez por loja e mês). */
    avisarDono: (ctx: IaContextoAtivo) => Promise<void>;
    now: () => Date;
    logger: { warn: (tag: string, msg: string) => void };
    avisados: BoundedTtlMap<true>;
}

const TAG = "IaConsumo";

export function criarControleLimite(over: Partial<ControleLimiteDeps> & Pick<ControleLimiteDeps, "store" | "avisarDono">) {
    const deps: ControleLimiteDeps = { now: () => new Date(), logger: defaultLogger, avisados: new BoundedTtlMap<true>(5_000, 35 * 24 * 3_600_000), ...over };
    return async (conversa: ConversaRef, ctx: IaContextoAtivo): Promise<DecisaoLimite> => {
        const loja = conversa.lojaCodigo;
        const limite = ctx.ia.plano_limite_conversas;
        ultimoLimite.set(loja, { limite });
        try {
            const agora = deps.now();
            const mes = mesSaoPaulo(agora);
            const total = (await deps.store.conversaNova(conversa, agora)) ? await deps.store.incrementar(loja, mes) : await deps.store.ler(loja, mes);
            if (limite === null || total <= limite) return "ok";
            const chave = `${loja}:${mes}`;
            if (!deps.avisados.has(chave)) {
                deps.avisados.set(chave, true);
                await deps.avisarDono(ctx).catch((e: unknown) => deps.logger.warn(TAG, `aviso de limite falhou: ${e instanceof Error ? e.name : "erro"}`));
            }
            return "so_link";
        } catch (e) {
            deps.logger.warn(TAG, `contagem falhou: ${e instanceof Error ? e.name : "erro"}`); // não silencia a IA por falha de contagem
            return "ok";
        }
    };
}
