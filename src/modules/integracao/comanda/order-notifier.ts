import { logger as defaultLogger } from "@/lib/logger";
import { isOptedOut as defaultIsOptedOut } from "@/lib/optout";
import { cloudSessionIds, getProvider as defaultGetProvider } from "@/modules/whatsapp/provider";
import { CloudApiError } from "@/modules/whatsapp/cloud/errors";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider/types";
import { registerComandaEventConsumer, type ComandaEventConsumer } from "./consumers";
import type { ComandaEvent } from "./schema";
import { BoundedTtlMap } from "./state";

/**
 * SAI-013, lado CRM: avisa o cliente do pedido por template da WhatsApp Cloud API.
 *
 * LIGADO SÓ POR OPÇÃO: sem COMANDA_NOTIFY_TEMPLATES=on, não envia nada (padrão). Assim o merge e o
 * deploy nunca disparam mensagens reais sozinhos.
 *
 * Template ({{1}} nome, {{2}} senha, {{3}} barraca; idioma pt_BR):
 *   order.created                       → pedido_recebido
 *   order.status_changed (status a_fazer) → pedido_em_preparo
 *   order.ready, retirada/mesa/balcão   → pedido_pronto
 *   order.ready, entrega                → pedido_saiu_entrega
 * Outros eventos (paid, cancelled, customer.*, coupon.*) não geram aviso.
 *
 * Regras: telefone ausente = não envia; cliente descadastrado = não envia; falha de envio nunca vira
 * erro para a Comanda nem bloqueia o evento (o consumidor roda isolado, depois do 200); o mesmo
 * template do mesmo pedido não sai duas vezes. Log só com contagens e códigos: NUNCA telefone, nome,
 * senha ou itens.
 */

export type TemplateName = "pedido_recebido" | "pedido_em_preparo" | "pedido_pronto" | "pedido_saiu_entrega";

export const TEMPLATE_LANGUAGE = "pt_BR";

/** Escolhe o template pelo evento. null = este evento não gera aviso. */
export function templateFor(event: ComandaEvent): TemplateName | null {
    const data = event.data as { status?: unknown; tipo_atendimento?: unknown };
    switch (event.type) {
        case "order.created":
            return "pedido_recebido";
        case "order.status_changed":
            return data.status === "a_fazer" ? "pedido_em_preparo" : null;
        case "order.ready":
            return data.tipo_atendimento === "entrega" ? "pedido_saiu_entrega" : "pedido_pronto";
        default:
            return null;
    }
}

/** Nome da barraca por env (o contrato v1 não traz o nome no evento): COMANDA_BARRACA_NOMES='{"<barraca_id>":"Açaí do Didi"}'. */
export function barracaName(barracaId: string, env: Record<string, string | undefined> = process.env): string {
    try {
        const map = JSON.parse(env.COMANDA_BARRACA_NOMES ?? "{}") as Record<string, unknown>;
        const name = map[barracaId];
        if (typeof name === "string" && name.trim()) return name.trim().slice(0, 60);
    } catch {
        /* variável inválida: usa o padrão */
    }
    return "a loja";
}

/** Parâmetro de template: sem quebra de linha nem espaços repetidos (a Meta recusa) e nunca vazio. */
function param(value: unknown, fallback: string): string {
    const t = typeof value === "string" || typeof value === "number" ? String(value).replace(/\s+/g, " ").trim() : "";
    return (t || fallback).slice(0, 60);
}

export interface NotifierDeps {
    getProvider: (sessionId: string) => WhatsAppProvider | null;
    isOptedOut: (sessionId: string, jid: string) => Promise<boolean>;
    env: Record<string, string | undefined>;
    logger: { info: (tag: string, msg: string) => void; warn: (tag: string, msg: string) => void };
    sent: BoundedTtlMap<true>;
}

const TAG = "AvisoPedido";

const defaultSent = new BoundedTtlMap<true>(10_000, 24 * 60 * 60 * 1000);

/** Cria o consumidor. Injetável para teste; `registerOrderNotifier` usa as dependências reais. */
export function createOrderNotifier(over: Partial<NotifierDeps> = {}): ComandaEventConsumer {
    const deps: NotifierDeps = {
        getProvider: defaultGetProvider,
        isOptedOut: defaultIsOptedOut,
        env: process.env,
        logger: defaultLogger,
        sent: defaultSent,
        ...over,
    };

    return async (event) => {
        if (deps.env.COMANDA_NOTIFY_TEMPLATES?.trim().toLowerCase() !== "on") return; // desligado (padrão)

        const template = templateFor(event);
        if (!template) return;

        const data = event.data as { pedido_id?: unknown; senha?: unknown; cliente?: { nome?: unknown; telefone?: unknown } | null };
        const phone = typeof data.cliente?.telefone === "string" ? data.cliente.telefone.replace(/\D/g, "") : "";
        if (phone.length < 8 || phone.length > 15) {
            deps.logger.info(TAG, `${template} pulado: sem telefone`);
            return;
        }

        // Piloto: 1 número da Cloud API (a primeira sessão de WHATSAPP_CLOUD_SESSION_ID).
        const sessionId = [...cloudSessionIds(deps.env)][0];
        const provider = sessionId ? deps.getProvider(sessionId) : null;
        if (!sessionId || !provider?.sendTemplate) {
            deps.logger.warn(TAG, `${template} pulado: Cloud API não configurada`);
            return;
        }

        const key = `${event.barraca_id}:${typeof data.pedido_id === "string" ? data.pedido_id : event.id}:${template}`;
        if (deps.sent.has(key)) {
            deps.logger.info(TAG, `${template} pulado: já enviado para este pedido`);
            return;
        }

        try {
            if (await deps.isOptedOut(sessionId, `${phone}@s.whatsapp.net`)) {
                deps.logger.info(TAG, `${template} pulado: cliente descadastrado`);
                return;
            }
            await provider.sendTemplate(phone, {
                name: template,
                languageCode: TEMPLATE_LANGUAGE,
                bodyParameters: [param(data.cliente?.nome, "cliente"), param(data.senha, "-"), barracaName(event.barraca_id, deps.env)],
            });
            deps.sent.set(key, true);
            deps.logger.info(TAG, `${template} enviado`);
        } catch (e) {
            // Nunca propaga: o aviso é secundário e o evento já foi aceito. Só tipo e código; sem telefone nem texto.
            const detail = e instanceof CloudApiError ? `${e.kind}${e.code !== null ? ` codigo=${e.code}` : ""}` : "erro_inesperado";
            deps.logger.warn(TAG, `${template} falhou: ${detail}`);
        }
    };
}

let registered = false;

/** Registra o notificador uma única vez (seguro chamar de novo, inclusive em desenvolvimento). */
export function registerOrderNotifier(): void {
    const g = globalThis as unknown as { __orderNotifierRegistered?: boolean };
    if (registered || g.__orderNotifierRegistered) return;
    registered = g.__orderNotifierRegistered = true;
    registerComandaEventConsumer(createOrderNotifier());
}
