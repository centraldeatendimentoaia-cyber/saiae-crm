import { z } from "zod";
import { dividirResposta, filtrarLinks, linksPermitidos } from "@/modules/agente-salao/motor";
import type { DefinicaoFerramenta, Llm } from "@/modules/ia-atendimento/llm";
import { MAX_PASSOS, montarMensagens, MSG_FALHA } from "@/modules/ia-atendimento/motor";
import { protegerSaida } from "@/modules/ia-atendimento/vendas/saida";
import { deveChamarPessoa } from "./gatilhos";
import { marcarMensagemRecebida, montarPromptAtendente } from "./prompt";
import type { Treino } from "./treino";

/**
 * Motor da atendente neutra. Mesmas defesas do motor legado: o que vem do cliente é DADO, o treino é a única fonte do que
 * ela afirma, links só os da base e da configuração, saída que pede dado sensível vira frase segura e qualquer erro vira
 * mensagem segura. As ações (avisar a equipe, etiquetar, registrar venda) entram por callbacks. Nunca lança.
 */

/** Frase de transferência quando o treino não tem nenhuma para o motivo. */
export const MSG_PESSOA_PADRAO = "Vou chamar uma pessoa da nossa equipe pra te ajudar com isso, tá bem? Só um instante.";

/** Teto de sanidade para o valor de uma venda informada pela IA: R$ 100.000,00. */
export const MAX_VALOR_VENDA_CENTAVOS = 100_000_00;

export interface PedidoPessoa {
    motivo: string;
    nome?: string;
    interesse?: string;
    resumo?: string;
}

export interface VendaAtendente {
    descricao: string;
    valorCentavos?: number;
}

export interface DepsMotor {
    llm: Llm;
    treino: Treino;
    /** Link do desfecho (agendamento, compra ou pagamento) da configuração. Nunca vem de argumento do modelo. */
    link?: string | null;
    /** Etiquetas que o modelo pode usar. Vazio = sem a ferramenta. */
    etiquetas: readonly string[];
    /** Cada ação devolve true quando deu certo; false ou exceção viram erro de ferramenta. */
    onPassarParaPessoa: (p: PedidoPessoa) => Promise<boolean>;
    onEtiquetar: (etiqueta: string) => Promise<boolean>;
    onRegistrarVenda: (v: VendaAtendente) => Promise<boolean>;
    logger: { warn: (tag: string, msg: string) => void };
}

export interface EntradaAtendente {
    texto: string;
    historico: { direcao: "in" | "out"; texto: string }[];
    nomePerfil?: string;
    agora: Date;
    /** Se a equipe atende agora; só informa o modelo, como no motor legado; não impede a resposta. */
    atendimentoHumanoAberto: boolean;
    primeiraResposta: boolean;
    mensagensSemAvancar: number;
}

export interface SaidaAtendente {
    mensagens: string[];
    passouParaPessoa: boolean;
    vendaRegistrada: boolean;
    falhou: boolean;
}

const VAZIO = { type: "object", properties: {}, additionalProperties: false };

export function ferramentasAtendente(opcoes: { etiquetas: readonly string[]; temLink: boolean }): DefinicaoFerramenta[] {
    const f: DefinicaoFerramenta[] = [
        {
            nome: "passar_para_pessoa",
            descricao: "Passa a conversa para uma pessoa da equipe. Use nos casos de PASSAR PARA PESSOA, quando a base não responde ou quando o cliente insiste depois de uma objeção. Preencha o que já sabe; deixe em branco o resto.",
            esquema: {
                type: "object",
                properties: {
                    motivo: { type: "string", maxLength: 64, description: "o motivo do caso de PASSAR PARA PESSOA, ou \"fora_da_base\"" },
                    nome: { type: "string", maxLength: 60 },
                    interesse: { type: "string", maxLength: 120 },
                    resumo: { type: "string", maxLength: 300 },
                },
                required: ["motivo"],
                additionalProperties: false,
            },
        },
        {
            nome: "registrar_venda",
            descricao: "Registra uma venda ou contratação que o cliente confirmou nesta conversa. Valor em centavos, só se estiver na base.",
            esquema: {
                type: "object",
                properties: {
                    descricao: { type: "string", minLength: 1, maxLength: 500 },
                    valor_centavos: { type: "integer", minimum: 0, maximum: MAX_VALOR_VENDA_CENTAVOS },
                },
                required: ["descricao"],
                additionalProperties: false,
            },
        },
    ];
    if (opcoes.temLink) f.push({ nome: "enviar_link", descricao: "Devolve o link oficial para o cliente seguir sozinho (agendar, comprar ou pagar).", esquema: VAZIO });
    if (opcoes.etiquetas.length) {
        f.push({
            nome: "etiquetar",
            descricao: "Marca a conversa com a etiqueta de interesse do cliente. Use uma vez por interesse, sem avisar o cliente.",
            esquema: { type: "object", properties: { etiqueta: { type: "string", enum: [...opcoes.etiquetas] } }, required: ["etiqueta"], additionalProperties: false },
        });
    }
    return f;
}

const texto = (max: number) => z.string().optional().transform((s) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max) || undefined);
const argsPessoa = z.object({ motivo: z.string().trim().min(1).max(64), nome: texto(60), interesse: texto(120), resumo: texto(300) });
const argsEtiqueta = z.object({ etiqueta: z.string().max(80) });
const argsVenda = z.object({ descricao: z.string().trim().min(1).max(500), valor_centavos: z.number().int().min(0).max(MAX_VALOR_VENDA_CENTAVOS).optional() });

interface ResultadoFerramenta {
    texto: string;
    erro?: boolean;
    passou?: boolean;
    venda?: boolean;
}

async function executarFerramenta(nome: string, argumentos: unknown, deps: DepsMotor, link: string | undefined): Promise<ResultadoFerramenta> {
    try {
        switch (nome) {
            case "passar_para_pessoa": {
                const a = argsPessoa.safeParse(argumentos);
                if (!a.success) return { texto: "pedido inválido", erro: true };
                return (await deps.onPassarParaPessoa(a.data))
                    ? { texto: "A equipe foi avisada. Responda só a frase do caso, sem prometer horário nem prazo.", passou: true }
                    : { texto: "Não foi possível avisar a equipe agora. Peça desculpas e diga que a equipe responde assim que possível, sem prometer horário.", erro: true };
            }
            case "enviar_link":
                return link
                    ? { texto: `Link oficial: ${link}` }
                    : { texto: "Não há link configurado. Não invente um: diga que uma pessoa da equipe vai ajudar e use passar_para_pessoa.", erro: true };
            case "etiquetar": {
                const a = argsEtiqueta.safeParse(argumentos);
                if (!a.success || !deps.etiquetas.includes(a.data.etiqueta)) return { texto: "etiqueta inválida", erro: true };
                return (await deps.onEtiquetar(a.data.etiqueta)) ? { texto: "etiquetado" } : { texto: "não foi possível etiquetar", erro: true };
            }
            case "registrar_venda": {
                const a = argsVenda.safeParse(argumentos);
                if (!a.success) return { texto: "venda inválida: descrição de 1 a 500 caracteres e valor_centavos inteiro entre 0 e o teto", erro: true };
                return (await deps.onRegistrarVenda({ descricao: a.data.descricao, valorCentavos: a.data.valor_centavos }))
                    ? { texto: "venda registrada", venda: true }
                    : { texto: "não foi possível registrar a venda", erro: true };
            }
            default:
                return { texto: "ferramenta desconhecida", erro: true };
        }
    } catch {
        return { texto: "falha ao executar a ferramenta", erro: true }; // nunca propaga nem registra a mensagem do erro
    }
}

const TAG = "Atendente";

export async function responderAtendente(deps: DepsMotor, e: EntradaAtendente): Promise<SaidaAtendente> {
    let passouParaPessoa = false;
    let vendaRegistrada = false;
    try {
        const t = deps.treino;
        const frase = (motivo?: string) => t.gatilhos.find((g) => g.ativo && g.id === motivo)?.frase || t.gatilhos.find((g) => g.ativo && g.frase)?.frase || MSG_PESSOA_PADRAO;

        // Gatilho com palavra-chave: passa para pessoa sem gastar uma chamada do modelo.
        const g = deveChamarPessoa({ texto: e.texto, mensagensSemAvancar: e.mensagensSemAvancar, gatilhos: t.gatilhos });
        if (g.chamar) {
            passouParaPessoa = await deps.onPassarParaPessoa({ motivo: g.gatilhoId! }).catch(() => false);
            return { mensagens: [g.frase || frase(g.gatilhoId)], passouParaPessoa, vendaRegistrada, falhou: false };
        }

        const link = deps.link ?? (t.roteiro.desfecho.tipo === "link" ? t.roteiro.desfecho.link : undefined) ?? undefined;
        const mensagens = montarMensagens(e.historico, e.texto).map((m) => (m.papel === "user" ? { ...m, texto: marcarMensagemRecebida(m.texto) } : m));
        const prompt = montarPromptAtendente(t, e);
        const permitidos = linksPermitidos(...t.base.map((b) => b.texto), link);
        const ferramentas = ferramentasAtendente({ etiquetas: deps.etiquetas, temLink: !!link });
        let motivo: string | undefined;

        for (let passo = 0; passo < MAX_PASSOS; passo++) {
            const saida = await deps.llm.responder({ sistema: prompt.estavel, sistemaVariavel: prompt.variavel, mensagens, ferramentas });
            if (saida.chamadas.length === 0) {
                const final = saida.texto ? filtrarLinks(saida.texto, permitidos) : "";
                if (!final) {
                    if (passouParaPessoa) return { mensagens: [frase(motivo)], passouParaPessoa, vendaRegistrada, falhou: false };
                    deps.logger.warn(TAG, "modelo sem resposta utilizável");
                    return { mensagens: [MSG_FALHA], passouParaPessoa, vendaRegistrada, falhou: true };
                }
                const segura = protegerSaida(final);
                if (segura.trocada) deps.logger.warn(TAG, "saída pedia dado sensível ou cobrava: trocada pela frase segura");
                return { mensagens: dividirResposta(segura.texto), passouParaPessoa, vendaRegistrada, falhou: false };
            }
            mensagens.push({ papel: "assistant", texto: saida.texto, chamadas: saida.chamadas });
            const resultados = [];
            for (const c of saida.chamadas) {
                const r = await executarFerramenta(c.nome, c.argumentos, deps, link);
                if (r.passou) {
                    passouParaPessoa = true;
                    motivo = (c.argumentos as { motivo?: string }).motivo;
                }
                if (r.venda) vendaRegistrada = true;
                resultados.push({ id: c.id, texto: r.texto, ...(r.erro ? { erro: true } : {}) });
            }
            mensagens.push({ papel: "tool", resultados });
        }
        deps.logger.warn(TAG, "limite de passos atingido");
        return { mensagens: passouParaPessoa ? [frase(motivo)] : [MSG_FALHA], passouParaPessoa, vendaRegistrada, falhou: !passouParaPessoa };
    } catch (err) {
        deps.logger.warn(TAG, `falha no motor: ${(err as { name?: string })?.name ?? "erro"}`);
        return { mensagens: [MSG_FALHA], passouParaPessoa, vendaRegistrada, falhou: true };
    }
}
