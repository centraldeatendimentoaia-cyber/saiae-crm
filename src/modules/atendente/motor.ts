import { z } from "zod";
import { dividirResposta, filtrarLinks, linksPermitidos } from "@/modules/agente-salao/motor";
import type { DefinicaoFerramenta, Llm } from "@/modules/ia-atendimento/llm";
import { MAX_PASSOS, montarMensagens, MSG_FALHA } from "@/modules/ia-atendimento/motor";
import { protegerSaida } from "@/modules/ia-atendimento/vendas/saida";
import { deveChamarPessoa } from "./gatilhos";
import { escaparMarcas, marcarMensagemRecebida, montarPromptAtendente } from "./prompt";
import type { Treino } from "./treino";

/**
 * Motor da atendente neutra. Mesmas defesas do motor legado: o que vem do cliente é DADO, o treino é a única fonte do que
 * ela afirma, links só os da base e da configuração, saída que pede dado sensível vira frase segura e qualquer erro vira
 * mensagem segura. As ações (avisar a equipe, etiquetar, registrar venda) entram por callbacks. Nunca lança.
 */

/** Frase de transferência quando o treino não tem nenhuma para o motivo. */
export const MSG_PESSOA_PADRAO = "Vou chamar uma pessoa da nossa equipe pra te ajudar com isso, tá bem? Só um instante.";

/** Quando o aviso à equipe falhou: não promete que alguém vai chamar agora. */
export const MSG_AVISO_FALHOU = "A equipe vai responder assim que possível.";

/** Teto de sanidade para o valor de uma venda informada pela IA: R$ 100.000,00. */
export const MAX_VALOR_VENDA_CENTAVOS = 100_000_00;

/** Ids dos gatilhos padrão (modelos-prontos.ts), usados quando a lista de motivos não é informada. */
const GATILHOS_PADRAO = ["reclamacao", "desconto", "pedido-humano", "assunto-sensivel", "audio", "sem-avanco"] as const;
const FORA_DA_BASE = "fora_da_base";

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
    /** A conversa devia passar para uma pessoa, mas o aviso à equipe falhou: quem chama deve pausar a IA ou tentar de novo. */
    avisoFalhou: boolean;
}

const VAZIO = { type: "object", properties: {}, additionalProperties: false };

export function ferramentasAtendente(opcoes: { etiquetas: readonly string[]; temLink: boolean; gatilhos?: readonly string[] }): DefinicaoFerramenta[] {
    const f: DefinicaoFerramenta[] = [
        {
            nome: "passar_para_pessoa",
            descricao: "Passa a conversa para uma pessoa da equipe. Use nos casos de PASSAR PARA PESSOA (motivo = id do caso), ou com motivo \"fora_da_base\" quando a base não responde ou o cliente insiste depois de uma objeção. Preencha o que já sabe; deixe em branco o resto.",
            esquema: {
                type: "object",
                properties: {
                    motivo: { type: "string", enum: [...(opcoes.gatilhos ?? GATILHOS_PADRAO), FORA_DA_BASE] },
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

// ---------------------------------------------------------------- links

const COM_ESQUEMA = /^https?:\/\//i;
// Domínio solto: rótulos com ponto e um final só de letras minúsculas (texto comum como "Sr.Silva" ou "4.7" não casa).
const DOMINIO_SOLTO = /^(?:[^\s/@]+@)?(?:[a-z0-9-]+\.)+[a-z]{2,24}\.?(?:[:/?#]|$)/;
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

const host = (url: string) => {
    try {
        return new URL(url).hostname;
    } catch {
        return null;
    }
};

/**
 * Segunda barreira depois de `filtrarLinks` (legado, que aceita qualquer endereço que COMECE com um link permitido, como
 * "https://agencia.com.evil.com"): cada endereço da saída é lido com `new URL` e só fica se o host for exatamente o de um
 * link permitido, sem usuário/senha. E-mails ficam (não abrem página).
 */
export function filtrarHosts(texto: string, permitidos: string[]): string {
    const hosts = new Set(permitidos.map(host).filter(Boolean));
    const limpo = texto.replace(/[^\s<>()"'[\]{}]+/g, (pedaco) => {
        const fim = /[.,;:!?…]+$/.exec(pedaco)?.[0] ?? "";
        const tok = pedaco.slice(0, pedaco.length - fim.length);
        const esquema = COM_ESQUEMA.test(tok);
        if (!esquema && (!DOMINIO_SOLTO.test(tok) || EMAIL.test(tok))) return pedaco;
        try {
            const u = new URL(esquema ? tok : `https://${tok}`);
            return !u.username && !u.password && hosts.has(u.hostname) ? pedaco : fim;
        } catch {
            return fim;
        }
    });
    return limpo.replace(/[ \t]{2,}/g, " ").trim();
}

// ---------------------------------------------------------------- ferramentas

const texto = (max: number) => z.string().optional().transform((s) => escaparMarcas((s ?? "").replace(/\s+/g, " ").trim().slice(0, max)) || undefined);
const argsEtiqueta = z.object({ etiqueta: z.string().max(80) });
const argsVenda = z.object({ descricao: z.string().trim().min(1).max(500), valor_centavos: z.number().int().min(0).max(MAX_VALOR_VENDA_CENTAVOS).optional() });

interface ResultadoFerramenta {
    texto: string;
    erro?: boolean;
}

/** O que já aconteceu neste turno, para não avisar a equipe nem registrar a venda duas vezes. */
interface Turno {
    motivo?: string;
    passou: boolean;
    venda: boolean;
    avisoFalhou: boolean;
}

async function executarFerramenta(nome: string, argumentos: unknown, deps: DepsMotor, link: string | undefined, motivos: readonly string[], turno: Turno): Promise<ResultadoFerramenta> {
    try {
        switch (nome) {
            case "passar_para_pessoa": {
                if (turno.passou) return { texto: "equipe já avisada nesta conversa; não chame de novo" };
                const a = z
                    .object({ motivo: z.string().refine((m) => motivos.includes(m)), nome: texto(60), interesse: texto(120), resumo: texto(300) })
                    .safeParse(argumentos);
                if (!a.success) return { texto: "pedido inválido: use um motivo da lista", erro: true };
                let ok = false;
                try {
                    ok = await deps.onPassarParaPessoa(a.data);
                } catch {
                    ok = false;
                }
                if (!ok) {
                    turno.avisoFalhou = true;
                    deps.logger.warn(TAG, "aviso à equipe falhou (ferramenta)");
                    return { texto: "Não foi possível avisar a equipe agora. Diga só que a equipe responde assim que possível, sem prometer horário nem dizer que alguém foi chamado.", erro: true };
                }
                Object.assign(turno, { passou: true, motivo: a.data.motivo });
                return { texto: "A equipe foi avisada." };
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
                if (turno.venda) return { texto: "venda já registrada nesta conversa; não registre de novo" };
                const a = argsVenda.safeParse(argumentos);
                if (!a.success) return { texto: "venda inválida: descrição de 1 a 500 caracteres e valor_centavos inteiro entre 0 e o teto", erro: true };
                if (!(await deps.onRegistrarVenda({ descricao: a.data.descricao, valorCentavos: a.data.valor_centavos }))) return { texto: "não foi possível registrar a venda", erro: true };
                turno.venda = true;
                return { texto: "venda registrada" };
            }
            default:
                return { texto: "ferramenta desconhecida", erro: true };
        }
    } catch {
        return { texto: "falha ao executar a ferramenta", erro: true }; // nunca propaga nem registra a mensagem do erro
    }
}

// ---------------------------------------------------------------- motor

const TAG = "Atendente";

export async function responderAtendente(deps: DepsMotor, e: EntradaAtendente): Promise<SaidaAtendente> {
    const turno: Turno = { passou: false, venda: false, avisoFalhou: false };
    const saida = (mensagens: string[], falhou = false): SaidaAtendente => ({
        mensagens,
        passouParaPessoa: turno.passou,
        vendaRegistrada: turno.venda,
        falhou,
        avisoFalhou: turno.avisoFalhou && !turno.passou,
    });
    try {
        const t = deps.treino;
        const ativos = t.gatilhos.filter((g) => g.ativo);
        // Frase de passagem: a do gatilho do motivo; senão a de "pedido-humano"; senão a primeira; senão a padrão.
        const frase = (motivo?: string) =>
            ativos.find((g) => g.id === motivo)?.frase || ativos.find((g) => g.id === "pedido-humano")?.frase || ativos.find((g) => g.frase)?.frase || MSG_PESSOA_PADRAO;

        // Gatilho com palavra-chave: passa para pessoa sem gastar uma chamada do modelo.
        const g = deveChamarPessoa({ texto: e.texto, mensagensSemAvancar: e.mensagensSemAvancar, gatilhos: t.gatilhos });
        if (g.chamar) {
            turno.passou = await Promise.resolve()
                .then(() => deps.onPassarParaPessoa({ motivo: g.gatilhoId! }))
                .catch(() => false);
            if (turno.passou) return saida([g.frase || frase(g.gatilhoId)]);
            turno.avisoFalhou = true;
            deps.logger.warn(TAG, `aviso à equipe falhou (gatilho ${g.gatilhoId})`);
            return saida([MSG_AVISO_FALHOU]);
        }

        const link = deps.link ?? (t.roteiro.desfecho.tipo === "link" ? t.roteiro.desfecho.link : undefined) ?? undefined;
        const mensagens = montarMensagens(e.historico, e.texto).map((m) => (m.papel === "user" ? { ...m, texto: marcarMensagemRecebida(m.texto) } : m));
        const prompt = montarPromptAtendente(t, e);
        const permitidos = linksPermitidos(...t.base.map((b) => b.texto), link);
        const motivos = [...ativos.map((x) => x.id), FORA_DA_BASE];
        const ferramentas = ferramentasAtendente({ etiquetas: deps.etiquetas, temLink: !!link, gatilhos: ativos.map((x) => x.id) });

        for (let passo = 0; passo < MAX_PASSOS; passo++) {
            const r = await deps.llm.responder({ sistema: prompt.estavel, sistemaVariavel: prompt.variavel, mensagens, ferramentas });
            if (r.chamadas.length === 0) {
                // Depois de passar para pessoa, o texto do modelo é descartado: vai só a frase fixa do treino.
                if (turno.passou) return saida([frase(turno.motivo)]);
                const final = r.texto ? filtrarHosts(filtrarLinks(r.texto, permitidos), permitidos) : "";
                if (!final) {
                    if (turno.avisoFalhou) return saida([MSG_AVISO_FALHOU]);
                    deps.logger.warn(TAG, "modelo sem resposta utilizável");
                    return saida([MSG_FALHA], true);
                }
                const segura = protegerSaida(final);
                if (segura.trocada) deps.logger.warn(TAG, "saída pedia dado sensível ou cobrava: trocada pela frase segura");
                return saida(dividirResposta(segura.texto));
            }
            mensagens.push({ papel: "assistant", texto: r.texto, chamadas: r.chamadas });
            const resultados = [];
            for (const c of r.chamadas) {
                const x = await executarFerramenta(c.nome, c.argumentos, deps, link, motivos, turno);
                resultados.push({ id: c.id, texto: x.texto, ...(x.erro ? { erro: true } : {}) });
            }
            mensagens.push({ papel: "tool", resultados });
        }
        deps.logger.warn(TAG, "limite de passos atingido");
        return turno.passou ? saida([frase(turno.motivo)]) : saida([MSG_FALHA], true);
    } catch (err) {
        deps.logger.warn(TAG, `falha no motor: ${(err as { name?: string })?.name ?? "erro"}`);
        return saida([MSG_FALHA], true);
    }
}
