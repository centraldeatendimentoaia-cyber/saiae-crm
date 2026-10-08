import { MAX_TEXTO } from "../constantes";
import type { Responder } from "../consumer";
import type { ConsumoStore } from "../consumo";
import { diaSaoPaulo } from "../dono";
import type { Llm } from "../llm";
import { filtrarSaida, MAX_HISTORICO, MAX_PASSOS, montarMensagens, MSG_FALHA } from "../motor";
import type { ConversaRef, IaStore } from "../store";
import { executarFerramentaVendas, FERRAMENTAS_VENDAS, type AcoesVendas, type MotivoHumano } from "./ferramentas";
import { montarPromptVendas } from "./prompt";

/**
 * Motor da atendente de vendas do Saiaê (mesmo número das lojas). Mesmas defesas do motor das lojas: histórico cortado,
 * no máximo MAX_PASSOS rodadas de ferramenta, saída sem links que não sejam o de cadastro, erro vira mensagem segura e
 * nada de telefone ou texto vai para o log. Nunca lança.
 */

const TAG = "IaVendas";
/** Sem link configurado, nenhum endereço passa pelo filtro. */
const LINK_AUSENTE = "https://link-de-cadastro-nao-configurado.invalid/";

export const VENDAS_MAX_RESPOSTAS_DIA_PADRAO = 100;

export interface VendasDeps {
    llm: Llm;
    store: Pick<IaStore, "historico">;
    /** Link oficial de cadastro/teste (IA_VENDAS_LINK_CADASTRO) ou null. */
    linkCadastro: string | null;
    chamarHumano: (conversa: ConversaRef, motivo: MotivoHumano) => Promise<boolean>;
    /** Teto diário (vendas e global). "so_link" = só manda o link de cadastro, sem chamar o modelo. */
    limite?: (conversa: ConversaRef) => Promise<"ok" | "so_link">;
    now: () => Date;
    logger: { warn: (tag: string, msg: string) => void };
}

export const mensagemSoLinkVendas = (link: string | null) =>
    link ? `No momento estou com muitas conversas. Para conhecer e testar o Saiaê, acesse: ${link}` : "No momento estou com muitas conversas. Uma pessoa da equipe vai responder assim que puder.";

export function criarResponderVendas(deps: VendasDeps): Responder {
    return async ({ conversa, texto, nomePerfil }) => {
        try {
            if (deps.limite && (await deps.limite(conversa)) === "so_link") return mensagemSoLinkVendas(deps.linkCadastro);

            const hist = await deps.store.historico(conversa.id, MAX_HISTORICO);
            const mensagens = montarMensagens(hist, texto.slice(0, MAX_TEXTO));
            const sistema = montarPromptVendas({ nomePerfil, primeiraResposta: !hist.some((h) => h.direcao === "out"), agora: deps.now() });
            const acoes: AcoesVendas = { linkCadastro: deps.linkCadastro, chamarHumano: (motivo) => deps.chamarHumano(conversa, motivo) };
            const linkPermitido = deps.linkCadastro ?? LINK_AUSENTE;

            for (let passo = 0; passo < MAX_PASSOS; passo++) {
                const saida = await deps.llm.responder({ sistema, mensagens, ferramentas: FERRAMENTAS_VENDAS });
                if (saida.chamadas.length === 0) {
                    const final = saida.texto ? filtrarSaida(saida.texto, linkPermitido) : "";
                    if (!final) {
                        deps.logger.warn(TAG, "modelo sem resposta utilizável");
                        return MSG_FALHA;
                    }
                    return final;
                }
                mensagens.push({ papel: "assistant", texto: saida.texto, chamadas: saida.chamadas });
                const resultados = [];
                for (const c of saida.chamadas) {
                    const r = await executarFerramentaVendas(c.nome, c.argumentos, acoes);
                    resultados.push({ id: c.id, texto: r.texto, ...(r.erro ? { erro: true } : {}) });
                }
                mensagens.push({ papel: "tool", resultados });
            }
            deps.logger.warn(TAG, "limite de passos atingido");
            return MSG_FALHA;
        } catch (e) {
            deps.logger.warn(TAG, `falha no motor de vendas: ${(e as { name?: string })?.name ?? "erro"}`);
            return MSG_FALHA;
        }
    };
}

export function maxRespostasVendasDia(env: Record<string, string | undefined>): number {
    const n = Number.parseInt(env.IA_VENDAS_MAX_RESPOSTAS_DIA ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : VENDAS_MAX_RESPOSTAS_DIA_PADRAO;
}

export interface ControleVendasDeps {
    store: Pick<ConsumoStore, "incrementar">;
    env: Record<string, string | undefined>;
    now: () => Date;
    /** Teto global da plataforma (IA_MAX_RESPOSTAS_DIA), compartilhado com as lojas. */
    maxGlobal: (env: Record<string, string | undefined>) => number;
    /** Avisa a equipe, no máximo uma vez por dia e motivo. */
    avisar: (motivo: "vendas" | "global") => Promise<void>;
    logger: { warn: (tag: string, msg: string) => void };
}

/**
 * Contadores do dia (São Paulo) na tabela IaConsumo: o de VENDAS (padrão 100, IA_VENDAS_MAX_RESPOSTAS_DIA) separado, para o
 * João ver quanto o panfleto gasta, e o global (que também vale para vendas). Falha ao contar nunca silencia a atendente.
 */
export function criarControleVendas(deps: ControleVendasDeps) {
    const avisados = new Set<string>();
    const avisarUma = async (dia: string, motivo: "vendas" | "global") => {
        const chave = `${dia}:${motivo}`;
        if (avisados.has(chave)) return;
        avisados.add(chave);
        await deps.avisar(motivo).catch((e: unknown) => deps.logger.warn(TAG, `aviso de limite falhou: ${e instanceof Error ? e.name : "erro"}`));
    };
    return async (_conversa: ConversaRef): Promise<"ok" | "so_link"> => {
        try {
            const dia = diaSaoPaulo(deps.now());
            if ((await deps.store.incrementar("GLOBAL", `vendas:${dia}`)) > maxRespostasVendasDia(deps.env)) {
                await avisarUma(dia, "vendas");
                return "so_link";
            }
            if ((await deps.store.incrementar("GLOBAL", `ia:${dia}`)) > deps.maxGlobal(deps.env)) {
                await avisarUma(dia, "global");
                return "so_link";
            }
            return "ok";
        } catch (e) {
            deps.logger.warn(TAG, `contagem falhou: ${e instanceof Error ? e.name : "erro"}`);
            return "ok";
        }
    };
}
