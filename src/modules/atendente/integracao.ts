import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { Llm } from "@/modules/ia-atendimento/llm";
import { MAX_TEXTO } from "@/modules/atendimento-comum/constantes";
import { sessaoEhDeBarraca } from "@/modules/agente-salao/barraca";
import type { MotivoRecepcao, PedidoRecepcao } from "@/modules/agente-salao/motor";
import { carregarPublicado } from "./armazenamento";
import { responderAtendente, type PedidoPessoa } from "./motor";
import type { Treino } from "./treino";

/**
 * Ponte entre o agente do salão (agente.ts) e a atendente neutra. Sessão com treino publicado responde pelo motor novo;
 * sem treino (ou com erro ao carregar) segue o motor legado, exatamente como antes. A pausa, o debounce, o envio e o
 * registro de origem continuam em agente.ts, iguais para os dois motores.
 */

const TAG = "Atendente";
const CACHE_MS = 30_000;
// Em globalThis: uma rota do Next (que limpa o cache ao publicar) e o agente do WhatsApp podem carregar este módulo em grafos
// separados do mesmo processo; sem isso cada um teria o seu cache e a limpeza não chegaria no agente.
const g = globalThis as { [k: symbol]: unknown };
const CHAVE_CACHE = Symbol.for("saiae.atendente.cache");
const cache = (g[CHAVE_CACHE] ??= new Map<string, { em: number; treino: Treino | null }>()) as Map<string, { em: number; treino: Treino | null }>;

/** Publicar ou reverter um treino chama isto para a troca valer na próxima mensagem. */
export function limparCacheAtendente(sessionId?: string): void {
    if (sessionId) cache.delete(sessionId);
    else cache.clear();
}

/** Treino publicado da sessão, ou null = usar o motor legado. Cache de 30 s, inclusive do "não tem". */
export async function usarAtendenteNovo(sessionId: string): Promise<Treino | null> {
    // Número de barraca do Sai aê é do bot de pedidos: nunca entra no motor novo, mesmo com treino publicado.
    if (await sessaoEhDeBarraca(sessionId)) return null;
    const hit = cache.get(sessionId);
    if (hit && Date.now() - hit.em < CACHE_MS) return hit.treino;
    try {
        const treino = await carregarPublicado(sessionId);
        cache.set(sessionId, { em: Date.now(), treino });
        return treino;
    } catch (e) {
        // Erro passageiro: serve o último valor conhecido (mesmo vencido), para um negócio publicado não cair na persona do
        // salão; sem nenhum valor (primeira carga, tabela ainda inexistente), legado. O erro também fica 30 s no cache: uma
        // consulta e um aviso por janela.
        const treino = hit?.treino ?? null;
        cache.set(sessionId, { em: Date.now(), treino });
        logger.warn(TAG, `não consegui carregar o treino publicado; ${treino ? "uso o último conhecido" : "segue o motor legado"}: ${(e as { name?: string })?.name ?? "erro"}`);
        return treino;
    }
}

/** Grava a venda informada pela atendente. Nunca lança: devolve false se a entrada é inválida ou o banco falha. */
export async function registrarVenda(sessionId: string, jid: string, v: { descricao: string; valorCentavos?: number }): Promise<boolean> {
    const descricao = (v.descricao ?? "").trim();
    const valorOk = v.valorCentavos === undefined || (Number.isInteger(v.valorCentavos) && v.valorCentavos >= 0);
    if (!descricao || descricao.length > 500 || !valorOk) {
        logger.warn(TAG, "venda inválida recusada");
        return false;
    }
    try {
        await prisma.vendaIA.create({ data: { sessionId, jid, descricao, valorCentavos: v.valorCentavos ?? null } });
        return true;
    } catch (e) {
        logger.warn(TAG, `não consegui registrar a venda: ${(e as { name?: string })?.name ?? "erro"}`);
        return false;
    }
}

// Motivos da atendente neutra (ids de gatilho) no formato do aviso legado à recepção.
const MOTIVO_RECEPCAO: Record<string, MotivoRecepcao> = { reclamacao: "reclamacao", desconto: "desconto", "pedido-humano": "pediu_humano", audio: "audio" };

function paraPedidoRecepcao(p: PedidoPessoa): PedidoRecepcao {
    const motivo = MOTIVO_RECEPCAO[p.motivo];
    // Sem equivalente (assunto sensível, sem avanço, fora da base, gatilhos do dono): vai como dúvida e o id no resumo.
    const resumo = motivo ? p.resumo : [`(${p.motivo})`, p.resumo].filter(Boolean).join(" ");
    return { motivo: motivo ?? "duvida", nome: p.nome, servico: p.interesse, resumo };
}

export interface EntradaComTreino {
    llm: Llm;
    treino: Treino;
    sessionId: string;
    jid: string;
    historico: { direcao: "in" | "out"; texto: string }[];
    /** Mensagens do cliente ainda sem resposta (o lote do debounce). */
    textos: string[];
    nomePerfil: string | null;
    agora: Date;
    atendimentoHumanoAberto: boolean;
    etiquetas: readonly string[];
    etiquetaAguardando: string | null;
    /** O mesmo chamarRecepcao do legado: aviso ao grupo/e-mail, pausa da IA e etiqueta "Aguardando resposta". */
    chamarRecepcao: (p: PedidoRecepcao) => Promise<boolean>;
    etiquetar: (etiqueta: string) => Promise<boolean>;
}

/** Responde com o motor novo e devolve no formato que agente.ts já usa para enviar e gravar o estado. */
export async function responderComTreino(a: EntradaComTreino): Promise<{ mensagens: string[]; chamouRecepcao: boolean; falhou: boolean }> {
    const desfecho = a.treino.roteiro.desfecho;
    const s = await responderAtendente(
        {
            llm: a.llm,
            treino: a.treino,
            link: desfecho.tipo === "link" ? desfecho.link : null,
            etiquetas: a.etiquetas,
            onPassarParaPessoa: (p) => a.chamarRecepcao(paraPedidoRecepcao(p)),
            onEtiquetar: a.etiquetar,
            onRegistrarVenda: (v) => registrarVenda(a.sessionId, a.jid, v),
            logger,
        },
        {
            texto: a.textos.join("\n").slice(0, MAX_TEXTO * 2), // mesmo corte do legado
            historico: a.historico,
            nomePerfil: a.nomePerfil ?? undefined,
            agora: a.agora,
            atendimentoHumanoAberto: a.atendimentoHumanoAberto,
            // Igual ao legado: primeira resposta = a IA ainda não falou nesta janela de histórico.
            primeiraResposta: !a.historico.some((h) => h.direcao === "out"),
            // shortcut: não há registro de avanço no roteiro, então o gatilho "sem-avanco" fica inerte; gravar um contador de progresso para ativá-lo.
            mensagensSemAvancar: 0,
        }
    );
    if (s.avisoFalhou) {
        // Como no legado, não pausa (ninguém foi avisado), mas marca a conversa para a equipe ver.
        logger.warn(TAG, "aviso à equipe falhou: conversa etiquetada para não ficar sem resposta");
        if (a.etiquetaAguardando) await a.etiquetar(a.etiquetaAguardando);
    }
    return { mensagens: s.mensagens, chamouRecepcao: s.passouParaPessoa, falhou: s.falhou && !s.passouParaPessoa };
}
