import type { ConversaRef } from "../store";
import type { Llm } from "../llm";
import { criarResponder } from "../motor";
import { criarResponderVendas } from "../vendas/motor";
import { CASOS, CTX_BASE, type Caso, type Execucao } from "./casos";
import { CASOS_VENDAS, LINK_VENDAS } from "./casos-vendas";

/**
 * Roda a bateria contra um LLM (real ou falso). O motor é o MESMO da produção; só o contexto da loja (fictício) e as
 * ações (que apenas anotam o que foi chamado, sem avisar ninguém) são trocados. Nada vai ao banco nem à Meta.
 */

export interface ResultadoCaso {
    nome: string;
    categoria: Caso["categoria"];
    passou: boolean;
    motivo: string | null;
}

export interface Relatorio {
    resultados: ResultadoCaso[];
    passaram: number;
    total: number;
}

const conversa: ConversaRef = { id: "avaliacao", lojaCodigo: "ABC234", contactKey: "5511900000000", estado: "ia", pausadaAte: null };

export async function executarCaso(llm: Llm, caso: Caso): Promise<Execucao> {
    const ferramentas: string[] = [];
    if (caso.vendas) {
        const vendas = criarResponderVendas({
            llm,
            store: { historico: async () => [{ direcao: "in", texto: caso.mensagem }] },
            linkCadastro: LINK_VENDAS,
            chamarHumano: async () => {
                ferramentas.push("chamar_humano");
                return true;
            },
            now: () => new Date("2026-10-12T17:35:00Z"),
            logger: { warn: () => undefined },
        });
        const resposta = await vendas({ conversa: { ...conversa, lojaCodigo: "VENDAS" }, texto: caso.mensagem, nomePerfil: caso.nomePerfil ?? null, contactKey: conversa.contactKey });
        return { resposta, ferramentas };
    }
    const responder = criarResponder({
        llm,
        store: { historico: async () => [{ direcao: "in", texto: caso.mensagem }] },
        contexto: async () => caso.ctx ?? CTX_BASE,
        acoes: () => ({
            chamarDono: async () => {
                ferramentas.push("chamar_dono");
                return true;
            },
            registrarPergunta: async () => {
                ferramentas.push("registrar_pergunta_sem_resposta");
            },
        }),
        logger: { warn: () => undefined },
    });
    const resposta = await responder({ conversa, texto: caso.mensagem, nomePerfil: caso.nomePerfil ?? null, contactKey: conversa.contactKey });
    // enviar_link_cardapio não tem efeito colateral; entra na lista pela presença do link na resposta
    return { resposta, ferramentas };
}

export async function avaliar(llm: Llm, opts: { casos?: Caso[]; filtro?: string; aoTerminarCaso?: (r: ResultadoCaso) => void } = {}): Promise<Relatorio> {
    const casos = (opts.casos ?? [...CASOS, ...CASOS_VENDAS]).filter((c) => !opts.filtro || c.nome.includes(opts.filtro));
    const resultados: ResultadoCaso[] = [];
    for (const caso of casos) {
        let motivo: string | null;
        try {
            motivo = caso.verificar(await executarCaso(llm, caso));
        } catch (e) {
            motivo = `erro ao executar: ${(e as { name?: string })?.name ?? "erro"}`;
        }
        const r: ResultadoCaso = { nome: caso.nome, categoria: caso.categoria, passou: motivo === null, motivo };
        resultados.push(r);
        opts.aoTerminarCaso?.(r);
    }
    return { resultados, passaram: resultados.filter((r) => r.passou).length, total: resultados.length };
}

/** Linha de resumo por categoria. */
export function resumo(rel: Relatorio): string {
    const por = (c: Caso["categoria"]) => {
        const rs = rel.resultados.filter((r) => r.categoria === c);
        return `${c}: ${rs.filter((r) => r.passou).length}/${rs.length}`;
    };
    return `${por("seguranca")} | ${por("qualidade")} | total ${rel.passaram}/${rel.total}`;
}
