import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

/**
 * Ponta a ponta do SAI-013 no CRM: evento assinado da Comanda → rota → notificador → CloudApiProvider
 * → (fetch simulado da Graph API). Nenhuma chamada real à Meta.
 */

const h = vi.hoisted(() => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    optOutFind: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { optOut: { findUnique: h.optOutFind } } }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));
vi.mock("@/modules/integracao/comanda/aviso-registro", () => ({
    registrarAvisoDoEvento: vi.fn().mockResolvedValue("sem_sessao"),
    barracaTemSessao: vi.fn().mockResolvedValue(false),
    sessaoDaBarraca: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/modules/integracao/comanda/aviso-worker", () => ({ iniciarWorkerAvisos: vi.fn(), acordarWorkerAvisos: vi.fn() }));

import { POST } from "./route";
import { resetEventState } from "@/modules/integracao/comanda/state";

const BARRACA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRET = "segredo-da-barraca-com-mais-de-16-chars";
const PHONE = "5561999990001";

const pedido = (over: Record<string, unknown> = {}) => ({
    pedido_id: crypto.randomUUID(), senha: 42, status: "a_fazer", tipo_atendimento: "retirada",
    itens: [{ nome: "Açaí 300ml", quantidade: 1, preco_centavos: 1600 }], total_centavos: 1600,
    cliente: { nome: "Maria Teste", telefone: PHONE.slice(2), consentimento_contato: true }, ...over,
});

function send(type: string, data: Record<string, unknown>, sequence = 1) {
    const ev = { id: crypto.randomUUID(), type, version: 1, occurred_at: "2026-10-08T12:00:00Z", barraca_id: BARRACA, sequence, data };
    const raw = JSON.stringify(ev);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
    return POST(new NextRequest("https://crm.exemplo.test/api/integracao/comanda/v1/eventos", {
        method: "POST", body: raw,
        headers: { "content-type": "application/json", "x-saiae-timestamp": ts, "x-saiae-signature": sig, "x-saiae-event-id": ev.id },
    }));
}

const fetchSpy = () => vi.spyOn(globalThis, "fetch");
const ok = () => new Response(JSON.stringify({ messages: [{ id: "wamid.T1" }] }), { status: 200, headers: { "content-type": "application/json" } });
const tick = () => new Promise((r) => setTimeout(r, 25));

beforeEach(() => {
    resetEventState();
    Object.values(h.logger).forEach((f) => f.mockReset());
    h.optOutFind.mockReset().mockResolvedValue(null);
    vi.stubEnv("COMANDA_WEBHOOK_SECRETS", JSON.stringify({ [BARRACA]: SECRET }));
    vi.stubEnv("COMANDA_NOTIFY_TEMPLATES", "on");
    vi.stubEnv("WHATSAPP_CLOUD_SESSION_ID", "pilot");
    vi.stubEnv("META_WA_ACCESS_TOKEN", "tok-de-teste");
    vi.stubEnv("META_WA_PHONE_NUMBER_ID", "123456");
    vi.stubEnv("COMANDA_BARRACA_NOMES", JSON.stringify({ [BARRACA]: "Açaí do Didi" }));
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("evento da Comanda → template pela Cloud API", () => {
    it("order.created: responde 200 e envia pedido_recebido com nome, senha e barraca", async () => {
        const spy = fetchSpy().mockResolvedValue(ok());
        expect((await send("order.created", pedido())).status).toBe(200);
        await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
        const [url, init] = spy.mock.calls[0];
        expect(String(url)).toBe("https://graph.facebook.com/v25.0/123456/messages");
        expect(JSON.parse((init as RequestInit).body as string)).toEqual({
            messaging_product: "whatsapp", recipient_type: "individual", to: PHONE, type: "template",
            template: { name: "pedido_recebido", language: { code: "pt_BR" }, components: [{ type: "body", parameters: [{ type: "text", text: "Maria Teste" }, { type: "text", text: "42" }, { type: "text", text: "Açaí do Didi" }] }] },
        });
    });
    it("order.ready (retirada ou entrega): sempre pedido_pronto", async () => {
        const spy = fetchSpy().mockResolvedValue(ok());
        await send("order.ready", pedido({ status: "pronto", tipo_atendimento: "entrega" }), 2);
        await send("order.ready", pedido({ status: "pronto" }), 2);
        await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
        const names = spy.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string).template.name);
        expect(names).toEqual(["pedido_pronto", "pedido_pronto"]);
    });
    it("status_changed, cancelled e paid não enviam nada (sem gatilho decidido)", async () => {
        const spy = fetchSpy().mockResolvedValue(ok());
        await send("order.status_changed", pedido({ status: "a_fazer" }), 2);
        await send("order.cancelled", pedido({ status: "cancelado" }), 3);
        await send("order.paid", pedido(), 4);
        await tick();
        expect(spy).not.toHaveBeenCalled();
    });
    it("barraca_nome do evento vira o {{3}} (prioridade sobre o env)", async () => {
        const spy = fetchSpy().mockResolvedValue(ok());
        await send("order.created", pedido({ barraca_nome: "Barraca do Evento" }));
        await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
        const params = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string).template.components[0].parameters;
        expect(params[2].text).toBe("Barraca do Evento");
    });
    it("a Meta recusa o envio: o evento continua 200 (nunca bloqueia) e o log traz só tipo e código", async () => {
        fetchSpy().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Template name does not exist", code: 132001 } }), { status: 400 }));
        expect((await send("order.created", pedido())).status).toBe(200);
        await vi.waitFor(() => expect(h.logger.warn.mock.calls.map((c) => c[1]).join()).toContain("pedido_recebido falhou: template codigo=132001"));
    });
    it("rede fora: o evento continua 200", async () => {
        fetchSpy().mockRejectedValue(new TypeError("fetch failed"));
        expect((await send("order.created", pedido())).status).toBe(200);
        await vi.waitFor(() => expect(h.logger.warn.mock.calls.map((c) => c[1]).join()).toContain("falhou: network"));
    });
    it("cliente descadastrado: 200 e nada é enviado", async () => {
        h.optOutFind.mockResolvedValue({ id: 1 });
        const spy = fetchSpy().mockResolvedValue(ok());
        expect((await send("order.created", pedido())).status).toBe(200);
        await tick();
        expect(spy).not.toHaveBeenCalled();
    });
    it("sem telefone: 200 e nada é enviado", async () => {
        const spy = fetchSpy().mockResolvedValue(ok());
        expect((await send("order.created", pedido({ cliente: { nome: "Maria" } }))).status).toBe(200);
        await tick();
        expect(spy).not.toHaveBeenCalled();
    });
    it("desligado (padrão): 200 e nada é enviado", async () => {
        vi.stubEnv("COMANDA_NOTIFY_TEMPLATES", "");
        const spy = fetchSpy().mockResolvedValue(ok());
        expect((await send("order.created", pedido())).status).toBe(200);
        await tick();
        expect(spy).not.toHaveBeenCalled();
    });
    it("evento duplicado (mesmo id) não envia duas vezes", async () => {
        const spy = fetchSpy().mockResolvedValue(ok());
        const data = pedido();
        const ev = { id: crypto.randomUUID(), type: "order.created", version: 1, occurred_at: "2026-10-08T12:00:00Z", barraca_id: BARRACA, sequence: 1, data };
        const raw = JSON.stringify(ev);
        const call = () => {
            const ts = String(Math.floor(Date.now() / 1000));
            const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
            return POST(new NextRequest("https://crm.exemplo.test/api/integracao/comanda/v1/eventos", { method: "POST", body: raw, headers: { "x-saiae-timestamp": ts, "x-saiae-signature": sig, "x-saiae-event-id": ev.id } }));
        };
        await call();
        await call();
        await tick();
        expect(spy).toHaveBeenCalledTimes(1);
    });
    it("nenhum telefone, nome, senha, itens, token nem nome da barraca no log", async () => {
        fetchSpy().mockResolvedValue(ok());
        await send("order.created", pedido());
        await vi.waitFor(() => expect(h.logger.info.mock.calls.map((c) => c[1]).join()).toContain("enviado"));
        const logged = JSON.stringify([h.logger.info.mock.calls, h.logger.warn.mock.calls, h.logger.error.mock.calls]);
        for (const dado of [PHONE, "Maria", "Açaí", "Didi", "tok-de-teste", SECRET]) expect(logged, dado).not.toContain(dado);
    });
});
