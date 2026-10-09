import { logger as defaultLogger } from "@/lib/logger";
import { normalizeBrPhone } from "@/modules/integracao/comanda/order-notifier";
import { canonicalPhone } from "@/lib/phone";
import type { TemplateInput } from "@/modules/whatsapp/provider/types";
import { buscarContexto, type IaContexto, type IaContextoAtivo } from "./comanda-contexto";
import type { MotivoDono } from "./ferramentas";
import { VENDAS, type ConversaRef, type IaStore } from "./store";
import { diaSaoPaulo } from "./tempo";

export { diaSaoPaulo };

/**
 * Passar o atendimento para o responsável da loja: aviso por template aprovado (fora da janela de 24 h só template
 * vale), pausa da IA naquela conversa e devolução (a IA volta sozinha em 12 h, ou quando o responsável manda
 * "LIBERAR #CODIGO" para o número da loja). Nunca registra telefone nem texto em log.
 */

export const TEMPLATE_DONO = "ia_chamar_dono";
/** Variante com a dúvida do cliente (5 variáveis). Só é usada se o nome estiver em IA_TEMPLATE_CHAMAR_DONO_DUVIDA (precisa estar aprovada na Meta). */
export const ENV_TEMPLATE_DONO_DUVIDA = "IA_TEMPLATE_CHAMAR_DONO_DUVIDA";
export const PAUSA_HORAS = 12;
export const MSG_RESPONSAVEL_AVISADO = "O responsável da loja já foi avisado e vai falar com você por aqui assim que puder. Obrigado pela paciência!";
export const MSG_IA_REATIVADA = "Pronto, a IA voltou a atender as conversas pausadas desta loja.";

const TAG = "IaDono";

/** Motivos do chamar_dono das lojas + o aviso de feedback do panfleto (usado só pela atendente de vendas). */
export type MotivoAviso = MotivoDono | "feedback_bonus";

const MOTIVOS: Record<MotivoAviso, string> = {
    nao_sei: "dúvida que a IA não soube responder",
    reclamacao: "reclamação",
    assunto_sensivel: "assunto sensível",
    pedido_humano: "cliente pediu atendimento humano",
    feedback_bonus: "FEEDBACK DO PANFLETO: confirmar e liberar +30 dias do Essencial",
};

/** Parâmetro de template: uma linha, sem espaços repetidos, nunca vazio. */
const param = (v: string, max = 60) => (v.replace(/\s+/g, " ").trim() || "-").slice(0, max);

export const pausadaAgora = (c: Pick<ConversaRef, "estado" | "pausadaAte">, agora: Date) => c.estado === "humano" && c.pausadaAte !== null && c.pausadaAte > agora;

/**
 * A dúvida do cliente como parâmetro de template: uma linha, sem links (um link na mão do responsável é risco de golpe),
 * sem espaços repetidos, no máximo 200 caracteres. Vazia vira null.
 */
export function limparDuvida(texto: string | null | undefined): string | null {
    if (typeof texto !== "string") return null;
    const t = texto
        .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link]")
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return t ? t.slice(0, 200) : null;
}

/** Máximo de avisos ao responsável por loja por dia (São Paulo). Acima disso a IA pausa a conversa mas NÃO envia mais template. */
export const MAX_AVISOS_DONO_DIA = 10;

export interface DonoDeps {
    /** Soma 1 ao contador (loja, chave) e devolve o novo total. Usa a tabela IaConsumo com chave "dono:AAAA-MM-DD". */
    contar?: (lojaCodigo: string, chave: string) => Promise<number>;
    enviarTemplate: (to: string, template: TemplateInput) => Promise<unknown>;
    store: Pick<IaStore, "pausar">;
    now: () => Date;
    /** Nome do template com a dúvida do cliente (padrão: variável IA_TEMPLATE_CHAMAR_DONO_DUVIDA). */
    templateDuvida?: string;
    logger: { info: (tag: string, msg: string) => void; warn: (tag: string, msg: string) => void };
}

/** Devolve `(conversa, ctx, motivo) => avisou?`. true também quando a conversa já estava pausada (já foi avisado); "teto" = pausou sem avisar (teto diário); false = falhou. */
export function criarChamadorDono(over: Partial<DonoDeps> & Pick<DonoDeps, "enviarTemplate" | "store">) {
    const deps: DonoDeps = { now: () => new Date(), logger: defaultLogger, ...over };
    return async (conversa: ConversaRef, ctx: IaContextoAtivo, motivo: MotivoAviso, duvida?: string | null): Promise<boolean | "teto"> => {
        const agora = deps.now();
        if (pausadaAgora(conversa, agora)) return true;
        const dono = normalizeBrPhone(ctx.ia.whatsapp_dono);
        if (!dono) {
            deps.logger.warn(TAG, "loja sem WhatsApp do responsável válido");
            return false;
        }
        if (deps.contar) {
            let total = 0;
            try {
                total = await deps.contar(conversa.lojaCodigo, `dono:${diaSaoPaulo(agora)}`);
            } catch (e) {
                deps.logger.warn(TAG, `contagem de avisos falhou: ${e instanceof Error ? e.name : "erro"}`); // sem contagem, avisa (não perde o cliente)
            }
            if (total > MAX_AVISOS_DONO_DIA) {
                // teto diário: pausa a conversa (a IA cala) mas não envia mais template para não inundar o responsável nem gerar custo
                await deps.store.pausar(conversa.id, new Date(agora.getTime() + PAUSA_HORAS * 3_600_000));
                deps.logger.warn(TAG, "teto diário de avisos ao responsável atingido: conversa pausada sem novo aviso");
                return "teto"; // pausou, mas NÃO avisou: quem chama não pode dizer "já avisei"
            }
        }
        const cliente = normalizeBrPhone(conversa.contactKey);
        try {
            const templateDuvida = (deps.templateDuvida ?? process.env[ENV_TEMPLATE_DONO_DUVIDA])?.trim();
            const pergunta = limparDuvida(duvida);
            if (templateDuvida && pergunta) {
                // variáveis: {{1}} loja, {{2}} motivo, {{3}} cliente, {{4}} dúvida, {{5}} código (ver docs/templates-meta-ia.md)
                await deps.enviarTemplate(dono, {
                    name: templateDuvida,
                    languageCode: "pt_BR",
                    bodyParameters: [param(ctx.loja.nome), MOTIVOS[motivo], cliente ?? "número não disponível", param(pergunta, 200), conversa.lojaCodigo],
                });
            } else {
                await deps.enviarTemplate(dono, {
                    name: TEMPLATE_DONO,
                    languageCode: "pt_BR",
                    bodyParameters: [param(ctx.loja.nome), MOTIVOS[motivo], cliente ?? "número não disponível", conversa.lojaCodigo],
                });
            }
        } catch (e) {
            deps.logger.warn(TAG, `aviso ao responsável falhou: ${e instanceof Error ? e.name : "erro"}`);
            return false;
        }
        await deps.store.pausar(conversa.id, new Date(agora.getTime() + PAUSA_HORAS * 3_600_000));
        deps.logger.info(TAG, `responsável avisado (motivo=${motivo})`);
        return true;
    };
}

/** Mesmo número, com ou sem o 9º dígito: o WhatsApp entrega o remetente de um jeito e o cadastro pode estar do outro. */
const mesmoTelefone = (a: string | null, b: string | null) => !!a && !!b && canonicalPhone(a) === canonicalPhone(b);

const LIBERAR = /^\s*liberar\s+#?([A-Za-z0-9]{6})\s*$/i;

export interface LiberadorDeps {
    contexto: (codigoLoja: string, telefone: string) => Promise<IaContexto>;
    /** WhatsApp da equipe do Saiaê (IA_VENDAS_WHATSAPP_RESPONSAVEL): vale para "LIBERAR #VENDAS". */
    responsavelVendas?: () => string | undefined;
    store: Pick<IaStore, "retomarLoja">;
    logger: { info: (tag: string, msg: string) => void };
}

/**
 * Trata "LIBERAR #CODIGO" vindo do responsável. Só vale se o remetente é EXATAMENTE o WhatsApp do responsável
 * cadastrado na Comanda para aquela loja. Devolve o texto de confirmação, ou null se não é um pedido de liberação
 * válido (qualquer outro remetente segue como cliente comum e nada é revelado).
 */
export function criarLiberador(over: Partial<LiberadorDeps> & Pick<LiberadorDeps, "store">) {
    const deps: LiberadorDeps = { contexto: (l, t) => buscarContexto(l, t), responsavelVendas: () => process.env.IA_VENDAS_WHATSAPP_RESPONSAVEL, logger: defaultLogger, ...over };
    return async (texto: string, contactKey: string): Promise<string | null> => {
        const m = LIBERAR.exec(texto);
        if (!m) return null;
        const codigo = m[1].toUpperCase();
        const remetente = normalizeBrPhone(contactKey);
        if (!remetente) return null;
        if (codigo === VENDAS) {
            // a "loja" da atendente de vendas não existe na Comanda: o responsável é o número configurado no CRM
            const equipe = normalizeBrPhone(deps.responsavelVendas?.());
            if (!mesmoTelefone(equipe, remetente)) return null;
        } else {
            const ctx = await deps.contexto(codigo, remetente);
            if (!ctx.ativa || !mesmoTelefone(normalizeBrPhone(ctx.ia.whatsapp_dono), remetente)) return null;
        }
        const n = await deps.store.retomarLoja(codigo);
        deps.logger.info(TAG, `conversas devolvidas à IA: ${n}`);
        return MSG_IA_REATIVADA;
    };
}

/** Aviso único por período: o limite de conversas do plano (mês) ou o teto diário da plataforma acabou. Não pausa nada (a IA segue só com o link). */
export function criarAvisoLimite(enviarTemplate: DonoDeps["enviarTemplate"]) {
    return async (ctx: IaContextoAtivo, motivo: "plano" | "global" = "plano"): Promise<void> => {
        const dono = normalizeBrPhone(ctx.ia.whatsapp_dono);
        if (!dono) return;
        await enviarTemplate(dono, {
            name: TEMPLATE_DONO,
            languageCode: "pt_BR",
            bodyParameters: [
                param(ctx.loja.nome),
                param(motivo === "global" ? "limite diário de respostas da IA atingido; ela só envia o link do cardápio até amanhã" : "limite mensal de conversas da IA atingido; ela só envia o link do cardápio até o mês virar", 200),
                "nenhum",
                "-",
            ],
        });
    };
}
