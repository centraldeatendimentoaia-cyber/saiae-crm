import { logger as defaultLogger } from "@/lib/logger";
import { normalizeBrPhone } from "@/modules/integracao/comanda/order-notifier";
import type { TemplateInput } from "@/modules/whatsapp/provider/types";
import { buscarContexto, type IaContexto, type IaContextoAtivo } from "./comanda-contexto";
import type { MotivoDono } from "./ferramentas";
import type { ConversaRef, IaStore } from "./store";

/**
 * Passar o atendimento para o responsável da loja: aviso por template aprovado (fora da janela de 24 h só template
 * vale), pausa da IA naquela conversa e devolução (a IA volta sozinha em 12 h, ou quando o responsável manda
 * "LIBERAR #CODIGO" para o número da loja). Nunca registra telefone nem texto em log.
 */

export const TEMPLATE_DONO = "ia_chamar_dono";
export const PAUSA_HORAS = 12;
export const MSG_RESPONSAVEL_AVISADO = "O responsável da loja já foi avisado e vai falar com você por aqui assim que puder. Obrigado pela paciência!";
export const MSG_IA_REATIVADA = "Pronto, a IA voltou a atender as conversas pausadas desta loja.";

const TAG = "IaDono";

const MOTIVOS: Record<MotivoDono, string> = {
    nao_sei: "dúvida que a IA não soube responder",
    reclamacao: "reclamação",
    assunto_sensivel: "assunto sensível",
    pedido_humano: "cliente pediu atendimento humano",
};

/** Parâmetro de template: uma linha, sem espaços repetidos, nunca vazio. */
const param = (v: string, max = 60) => (v.replace(/\s+/g, " ").trim() || "-").slice(0, max);

export const pausadaAgora = (c: Pick<ConversaRef, "estado" | "pausadaAte">, agora: Date) => c.estado === "humano" && c.pausadaAte !== null && c.pausadaAte > agora;

export interface DonoDeps {
    enviarTemplate: (to: string, template: TemplateInput) => Promise<unknown>;
    store: Pick<IaStore, "pausar">;
    now: () => Date;
    logger: { info: (tag: string, msg: string) => void; warn: (tag: string, msg: string) => void };
}

/** Devolve `(conversa, ctx, motivo) => avisou?`. true também quando a conversa já estava pausada (já foi avisado). */
export function criarChamadorDono(over: Partial<DonoDeps> & Pick<DonoDeps, "enviarTemplate" | "store">) {
    const deps: DonoDeps = { now: () => new Date(), logger: defaultLogger, ...over };
    return async (conversa: ConversaRef, ctx: IaContextoAtivo, motivo: MotivoDono): Promise<boolean> => {
        const agora = deps.now();
        if (pausadaAgora(conversa, agora)) return true;
        const dono = normalizeBrPhone(ctx.ia.whatsapp_dono);
        if (!dono) {
            deps.logger.warn(TAG, "loja sem WhatsApp do responsável válido");
            return false;
        }
        const cliente = normalizeBrPhone(conversa.contactKey);
        try {
            await deps.enviarTemplate(dono, {
                name: TEMPLATE_DONO,
                languageCode: "pt_BR",
                bodyParameters: [param(ctx.loja.nome), MOTIVOS[motivo], cliente ?? "número não disponível", conversa.lojaCodigo],
            });
        } catch (e) {
            deps.logger.warn(TAG, `aviso ao responsável falhou: ${e instanceof Error ? e.name : "erro"}`);
            return false;
        }
        await deps.store.pausar(conversa.id, new Date(agora.getTime() + PAUSA_HORAS * 3_600_000));
        deps.logger.info(TAG, `responsável avisado (motivo=${motivo})`);
        return true;
    };
}

const LIBERAR = /^\s*liberar\s+#?([A-Za-z0-9]{6})\s*$/i;

export interface LiberadorDeps {
    contexto: (codigoLoja: string, telefone: string) => Promise<IaContexto>;
    store: Pick<IaStore, "retomarLoja">;
    logger: { info: (tag: string, msg: string) => void };
}

/**
 * Trata "LIBERAR #CODIGO" vindo do responsável. Só vale se o remetente é EXATAMENTE o WhatsApp do responsável
 * cadastrado na Comanda para aquela loja. Devolve o texto de confirmação, ou null se não é um pedido de liberação
 * válido (qualquer outro remetente segue como cliente comum e nada é revelado).
 */
export function criarLiberador(over: Partial<LiberadorDeps> & Pick<LiberadorDeps, "store">) {
    const deps: LiberadorDeps = { contexto: (l, t) => buscarContexto(l, t), logger: defaultLogger, ...over };
    return async (texto: string, contactKey: string): Promise<string | null> => {
        const m = LIBERAR.exec(texto);
        if (!m) return null;
        const codigo = m[1].toUpperCase();
        const remetente = normalizeBrPhone(contactKey);
        if (!remetente) return null;
        const ctx = await deps.contexto(codigo, remetente);
        if (!ctx.ativa || normalizeBrPhone(ctx.ia.whatsapp_dono) !== remetente) return null;
        const n = await deps.store.retomarLoja(codigo);
        deps.logger.info(TAG, `conversas devolvidas à IA: ${n}`);
        return MSG_IA_REATIVADA;
    };
}
