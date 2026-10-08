import { logger as defaultLogger } from "@/lib/logger";
import { normalizeBrPhone } from "@/modules/integracao/comanda/order-notifier";
import type { TemplateInput } from "@/modules/whatsapp/provider/types";
import { assinar, TIMEOUT_MS } from "./comanda-contexto";
import { diaSaoPaulo, TEMPLATE_DONO } from "./dono";

/**
 * Confirmação do WhatsApp do responsável da loja. A Comanda guarda o número que o dono digitou; para a IA poder avisar
 * esse número (e aceitar "LIBERAR") ele precisa provar que é dele:
 *  1. a Comanda chama a rota `ia-dono-pedir-confirmacao` {codigo_loja, telefone} -> o CRM envia o template a ESSE telefone
 *     pedindo "CONFIRMAR #CODIGO" (a IA fica desligada até a confirmação, então o ia-contexto não serve para achar o número);
 *  2. o dono responde do próprio número; o CRM avisa a Comanda (edge function `ia-dono-confirmar`, mesma assinatura do
 *     ia-contexto) com o remetente, e QUEM COMPARA É A COMANDA (DDD + 8 últimos dígitos). Só com {confirmado:true} o dono
 *     recebe "Número confirmado"; qualquer outro resultado não revela nada (segue como mensagem comum).
 * Nunca registra telefone nem texto em log.
 */

const TAG = "IaConfirmarDono";
export const MAX_PEDIDOS_CONFIRMACAO_DIA = 3;
export const MSG_NUMERO_CONFIRMADO = "Número confirmado! A partir de agora você recebe aqui os avisos da IA desta loja.";

export type MotivoNaoEnviado = "sem_whatsapp" | "limite" | "falha_envio";
export type ResultadoPedido = { enviado: true } | { enviado: false; motivo: MotivoNaoEnviado };

export interface PedidoDeps {
    enviarTemplate: (to: string, template: TemplateInput) => Promise<unknown>;
    /** Soma 1 ao contador (loja, chave) e devolve o total (tabela IaConsumo, chave "confirmar:AAAA-MM-DD"). */
    contar: (lojaCodigo: string, chave: string) => Promise<number>;
    now: () => Date;
    logger: { info: (tag: string, msg: string) => void; warn: (tag: string, msg: string) => void };
}

/** Pedido da Comanda: manda o template de confirmação ao telefone informado (vem do banco da Comanda). No máximo 3 por loja por dia. */
export function criarPedidoConfirmacao(over: Partial<PedidoDeps> & Pick<PedidoDeps, "enviarTemplate" | "contar">) {
    const deps: PedidoDeps = { now: () => new Date(), logger: defaultLogger, ...over };
    return async (codigoLoja: string, telefone: string): Promise<ResultadoPedido> => {
        const dono = normalizeBrPhone(telefone);
        if (!dono) return { enviado: false, motivo: "sem_whatsapp" };
        try {
            if ((await deps.contar(codigoLoja, `confirmar:${diaSaoPaulo(deps.now())}`)) > MAX_PEDIDOS_CONFIRMACAO_DIA) {
                deps.logger.warn(TAG, "limite diário de pedidos de confirmação atingido");
                return { enviado: false, motivo: "limite" };
            }
        } catch (e) {
            deps.logger.warn(TAG, `contagem falhou: ${e instanceof Error ? e.name : "erro"}`);
            return { enviado: false, motivo: "falha_envio" }; // sem contagem não arrisca enviar sem teto
        }
        try {
            await deps.enviarTemplate(dono, {
                name: TEMPLATE_DONO,
                languageCode: "pt_BR",
                bodyParameters: [
                    "sua loja",
                    `confirmar este número como responsável da loja; responda CONFIRMAR #${codigoLoja}`,
                    "nenhum",
                    codigoLoja,
                ],
            });
        } catch (e) {
            deps.logger.warn(TAG, `envio do pedido de confirmação falhou: ${e instanceof Error ? e.name : "erro"}`);
            return { enviado: false, motivo: "falha_envio" };
        }
        deps.logger.info(TAG, "pedido de confirmação enviado");
        return { enviado: true };
    };
}

/** CRM -> Comanda: edge function `ia-dono-confirmar`, assinada como o ia-contexto. Devolve true só com 200 {confirmado:true} (confirmado:false = número diferente ou loja inexistente). */
export async function confirmarNaComanda(
    codigoLoja: string,
    telefone: string,
    over: { fetch?: typeof fetch; env?: Record<string, string | undefined>; now?: () => number; logger?: { warn: (tag: string, msg: string) => void } } = {},
): Promise<boolean> {
    const env = over.env ?? process.env;
    const log = over.logger ?? defaultLogger;
    const segredo = env.COMANDA_IA_SEGREDO?.trim().split(",")[0]?.trim();
    const url = env.COMANDA_IA_DONO_CONFIRMAR_URL?.trim();
    if (!segredo || !url) {
        log.warn(TAG, "COMANDA_IA_SEGREDO ou COMANDA_IA_DONO_CONFIRMAR_URL ausente");
        return false;
    }
    const corpo = JSON.stringify({ codigo_loja: codigoLoja, telefone });
    const timestamp = String(Math.floor((over.now ?? Date.now)() / 1000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await (over.fetch ?? fetch)(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Saiae-Timestamp": timestamp, "X-Saiae-Signature": assinar(segredo, timestamp, corpo) },
            body: corpo,
            signal: controller.signal,
        });
        if (!res.ok) {
            log.warn(TAG, `Comanda respondeu HTTP ${res.status} ao confirmar`);
            return false;
        }
        const json = (await res.json()) as { confirmado?: unknown };
        return json?.confirmado === true;
    } catch (e) {
        log.warn(TAG, (e as { name?: string })?.name === "AbortError" ? "tempo esgotado confirmando na Comanda" : "falha de rede confirmando na Comanda");
        return false;
    } finally {
        clearTimeout(timer);
    }
}

const CONFIRMAR = /^\s*confirmar\s+#?([A-Za-z0-9]{6})\s*$/i;

export interface ConfirmadorDeps {
    confirmar: (codigoLoja: string, telefone: string) => Promise<boolean>;
    logger: { info: (tag: string, msg: string) => void };
}

/**
 * Trata "CONFIRMAR #CODIGO". Quem decide se o remetente é o dono é a Comanda; sem {confirmado:true} devolve null
 * (a mensagem segue como de cliente comum e nada é revelado: nem que a loja existe, nem o número cadastrado).
 */
export function criarConfirmador(over: Partial<ConfirmadorDeps> = {}) {
    const deps: ConfirmadorDeps = { confirmar: (l, t) => confirmarNaComanda(l, t), logger: defaultLogger, ...over };
    return async (texto: string, contactKey: string): Promise<string | null> => {
        const m = CONFIRMAR.exec(texto);
        if (!m) return null;
        const remetente = normalizeBrPhone(contactKey);
        if (!remetente) return null;
        const ok = await deps.confirmar(m[1].toUpperCase(), remetente);
        if (!ok) return null;
        deps.logger.info(TAG, "número do responsável confirmado");
        return MSG_NUMERO_CONFIRMADO;
    };
}
