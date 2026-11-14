import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Sprint 3: duas lojas/duas sessões Cloud. Webhook de um número não chega à outra sessão, IA e notificador usam a
 * sessão certa e a ambiguidade falha de forma explícita (registrada), nunca na "primeira sessão".
 */
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import { criarConsumidorIa, criarDepsPadrao } from "./consumer";
import { criarProviderCloud } from "./registro";
import { createOrderNotifier } from "@/modules/integracao/comanda/order-notifier";
import { BoundedTtlMap } from "@/modules/integracao/comanda/state";
import type { IaStore, ConversaRef } from "./store";
import type { InboundMessage, NormalizedBatch } from "@/modules/whatsapp/cloud/inbound";

const T0 = new Date("2026-10-08T12:00:00Z");
const ENV_BASE = {
    IA_ATENDIMENTO: "on",
    WHATSAPP_CLOUD_SESSION_ID: "loja-a,loja-b",
    WHATSAPP_CLOUD_PHONE_MAP: JSON.stringify({ "111": "loja-a", "222": "loja-b" }),
    WHATSAPP_CLOUD_BARRACA_MAP: JSON.stringify({ "barraca-a": "loja-a", "barraca-b": "loja-b" }),
};

function msg(phoneNumberId: string | null, id: string): InboundMessage {
    return {
        kind: "message", provider: "cloud-api", messageId: id, phoneNumberId, displayPhone: null, timestamp: T0, type: "text", rawType: "text",
        text: "Oi #K7P2QX", from: { phone: "5561999990001", userId: null, username: null, name: "Maria", contactKey: "5561999990001" },
        media: null, location: null, contacts: [], replyId: null, reaction: null, replyToMessageId: null, forwarded: false, referral: null, errors: [],
    } as InboundMessage;
}
const lote = (...m: InboundMessage[]): NormalizedBatch => ({ events: m, ignored: 0 });

function setup(env: Record<string, string | undefined>) {
    const conversa: ConversaRef = { id: "c1", lojaCodigo: "K7P2QX", contactKey: "5561999990001", estado: "ia", pausadaAte: null };
    const store = {
        registrarMensagem: vi.fn().mockResolvedValue({ novo: true, conversa }),
        lojaDaConversa: vi.fn().mockResolvedValue(null), historico: vi.fn(), pausar: vi.fn(), retomar: vi.fn(), retomarLoja: vi.fn(),
    } as unknown as IaStore;
    const optOut = { is: vi.fn().mockResolvedValue(false), add: vi.fn(), remove: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const responder = vi.fn().mockResolvedValue("ok");
    const enviar = vi.fn().mockResolvedValue("wamid.OUT");
    const run = criarConsumidorIa(criarDepsPadrao({ store, optOut, logger, responder, enviar, env, now: () => T0 }));
    return { run, store, optOut, logger, responder };
}

describe("IA: webhook de um número só chega à sessão dona", () => {
    it("número 111 usa loja-a (a consulta de opt-out mostra a sessão usada)", async () => {
        const { run, optOut } = setup({ ...ENV_BASE, META_WA_PHONE_NUMBER_ID: "111" });
        await run(lote(msg("111", "wamid.1")));
        expect(optOut.is).toHaveBeenCalledWith("loja-a", expect.any(String));
        expect(optOut.is).not.toHaveBeenCalledWith("loja-b", expect.any(String));
    });
    it("lote com os dois números: o que NÃO é o número de envio é recusado (não responde pelo número de outra loja)", async () => {
        const { run, optOut, logger, responder } = setup({ ...ENV_BASE, META_WA_PHONE_NUMBER_ID: "111" });
        await run(lote(msg("111", "wamid.1"), msg("222", "wamid.2")));
        expect(optOut.is).toHaveBeenCalledTimes(1);
        expect(responder).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith("IaAtendimento", expect.stringContaining("diferente do número de envio"));
    });
    it("número desconhecido: recusa, registra e não grava nem responde", async () => {
        const { run, store, responder, logger } = setup({ ...ENV_BASE, META_WA_PHONE_NUMBER_ID: "111" });
        await run(lote(msg("999", "wamid.3")));
        expect(store.registrarMensagem).not.toHaveBeenCalled();
        expect(responder).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith("IaAtendimento", expect.stringContaining("mensagem recusada"));
    });
    it("duas sessões e nenhum mapa: ambíguo, falha explícita (nunca a primeira)", async () => {
        const { run, store, optOut, logger } = setup({ IA_ATENDIMENTO: "on", WHATSAPP_CLOUD_SESSION_ID: "loja-a,loja-b" });
        await run(lote(msg("111", "wamid.4")));
        expect(store.registrarMensagem).not.toHaveBeenCalled();
        expect(optOut.is).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith("IaAtendimento", expect.stringContaining("ambigua"));
    });
    it("uma sessão só: comportamento de sempre, mesmo sem mapa", async () => {
        const { run, optOut, responder } = setup({ IA_ATENDIMENTO: "on", WHATSAPP_CLOUD_SESSION_ID: "pilot" });
        await run(lote(msg("qualquer", "wamid.5")));
        expect(optOut.is).toHaveBeenCalledWith("pilot", expect.any(String));
        expect(responder).toHaveBeenCalled();
    });
});

describe("IA: provedor de envio", () => {
    const base = { META_WA_ACCESS_TOKEN: "t", META_WA_PHONE_NUMBER_ID: "222" };
    it("várias sessões com mapa: o provedor é o da sessão dona do número de envio", () => {
        expect(criarProviderCloud({ ...ENV_BASE, ...base })?.sessionId).toBe("loja-b");
    });
    it("várias sessões sem mapa: não cria provedor (ambíguo)", () => {
        expect(criarProviderCloud({ ...base, WHATSAPP_CLOUD_SESSION_ID: "loja-a,loja-b" })).toBeNull();
    });
});

describe("Notificador de pedidos: cada barraca na própria sessão", () => {
    const sendTemplate = vi.fn().mockResolvedValue({ messageId: "w" });
    beforeEach(() => sendTemplate.mockClear());
    const ev = (barraca: string) =>
        ({
            id: crypto.randomUUID(), type: "order.created", version: 1, occurred_at: "2026-10-08T12:00:00Z", barraca_id: barraca, sequence: 1,
            data: { pedido_id: `p-${barraca}`, senha: 1, cliente: { nome: "Maria", telefone: "61999990001" } },
        }) as never;
    function run(env: Record<string, string | undefined>) {
        const getProvider = vi.fn(() => ({ sendTemplate }) as never);
        const logger = { info: vi.fn(), warn: vi.fn() };
        const notifier = createOrderNotifier({ env: { COMANDA_NOTIFY_TEMPLATES: "on", ...env }, getProvider, logger, isOptedOut: async () => false, sent: new BoundedTtlMap<true>(10, 60_000), barracaTemSessao: async () => false });
        return { notifier, getProvider, logger };
    }
    it("barraca-b com número de envio de loja-b: usa loja-b", async () => {
        const { notifier, getProvider } = run({ ...ENV_BASE, META_WA_PHONE_NUMBER_ID: "222" });
        await notifier(ev("barraca-b"));
        expect(getProvider).toHaveBeenCalledWith("loja-b");
        expect(sendTemplate).toHaveBeenCalledTimes(1);
    });
    it("barraca-a mas o número de envio é o de loja-b: NÃO envia (sairia pelo número de outra loja)", async () => {
        const { notifier, getProvider, logger } = run({ ...ENV_BASE, META_WA_PHONE_NUMBER_ID: "222" });
        await notifier(ev("barraca-a"));
        expect(getProvider).not.toHaveBeenCalled();
        expect(sendTemplate).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith("AvisoPedido", expect.stringContaining("não pertence"));
    });
    it("barraca fora do mapa: falha explícita, sem envio", async () => {
        const { notifier, logger } = run({ ...ENV_BASE, META_WA_PHONE_NUMBER_ID: "222" });
        await notifier(ev("barraca-x"));
        expect(sendTemplate).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith("AvisoPedido", expect.stringContaining("ambigua"));
    });
});
