import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
    getProvider: vi.fn(),
    getAuthenticatedUser: vi.fn(),
    canAccessSession: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/modules/whatsapp/provider", async (orig) => ({ ...(await orig<typeof import("@/modules/whatsapp/provider")>()), getProvider: h.getProvider }));
vi.mock("@/lib/api-auth", () => ({ getAuthenticatedUser: h.getAuthenticatedUser, canAccessSession: h.canAccessSession }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { POST } from "./route";
import { CloudApiProvider } from "@/modules/whatsapp/cloud/provider";
import { ClosedWindowStore } from "@/modules/whatsapp/cloud/window";
import { BaileysProvider } from "@/modules/whatsapp/provider/baileys";
import { FakeMetaServer, metaError } from "@/modules/whatsapp/cloud/fake-meta-server";

const TOKEN = "EAAG-token-secreto-de-teste-123456789";
const PHONE = "5561999999999";
const server = new FakeMetaServer();

beforeAll(() => server.start());
afterAll(() => server.stop());

const cloud = () =>
    new CloudApiProvider({
        sessionId: "pilot",
        windowStore: new ClosedWindowStore(),
        config: { phoneNumberId: "106540352242922", accessToken: TOKEN, baseUrl: server.baseUrl },
    });

const GOOD = { name: "pedido_em_preparo", languageCode: "pt_BR", bodyParameters: ["Maria", "42", "Açaí do Didi"] };

function call(body: unknown, jid: string = PHONE, raw?: string) {
    return POST(
        new NextRequest(`https://crm.exemplo.test/api/messages/pilot/${encodeURIComponent(jid)}/template`, {
            method: "POST",
            body: raw ?? JSON.stringify(body),
            headers: { "content-type": "application/json" },
        }),
        { params: Promise.resolve({ sessionId: "pilot", jid: encodeURIComponent(jid) }) }
    );
}

beforeEach(() => {
    server.reset();
    h.getProvider.mockReset().mockImplementation(() => cloud());
    h.getAuthenticatedUser.mockReset().mockResolvedValue({ id: "u1", role: "OWNER" });
    h.canAccessSession.mockReset().mockResolvedValue(true);
    Object.values(h.logger).forEach((f) => f.mockReset());
});

describe("autenticação e acesso", () => {
    it("sem login: 401 e nada enviado", async () => {
        h.getAuthenticatedUser.mockResolvedValue(null);
        expect((await call(GOOD)).status).toBe(401);
        expect(server.requests).toHaveLength(0);
    });
    it("sem acesso à sessão: 403 e nada enviado", async () => {
        h.canAccessSession.mockResolvedValue(false);
        expect((await call(GOOD)).status).toBe(403);
        expect(server.requests).toHaveLength(0);
    });
    it("401/403 vêm antes de qualquer detalhe do provedor (não vaza o tipo da sessão)", async () => {
        h.getAuthenticatedUser.mockResolvedValue(null);
        h.getProvider.mockReturnValue(new BaileysProvider({ sessionId: "s", socket: {} }));
        expect((await call(GOOD)).status).toBe(401);
        expect(h.getProvider).not.toHaveBeenCalled();
    });
});

describe("envio (provedor Cloud contra o servidor falso)", () => {
    it("manda o template certo e devolve o messageId", async () => {
        const res = await call(GOOD);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: true, message: "Template enviado", data: { messageId: "wamid.FAKE1" } });
        expect(server.requests).toHaveLength(1);
        expect(server.requests[0].path).toBe("/v25.0/106540352242922/messages");
        expect(server.requests[0].json).toEqual({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: PHONE,
            type: "template",
            template: {
                name: "pedido_em_preparo",
                language: { code: "pt_BR" },
                components: [{ type: "body", parameters: [{ type: "text", text: "Maria" }, { type: "text", text: "42" }, { type: "text", text: "Açaí do Didi" }] }],
            },
        });
    });
    it("sem bodyParameters: sem components", async () => {
        await call({ name: "ola", languageCode: "pt_BR" });
        expect((server.requests[0].json as { template: object }).template).toEqual({ name: "ola", language: { code: "pt_BR" } });
    });
    it.each([
        ["com DDI e só dígitos", "5561999999999"],
        ["com +", "+5561999999999"],
        ["formatado", "+55 (61) 99999-9999"],
        ["com sufixo do WhatsApp", "5561999999999@s.whatsapp.net"],
    ])("aceita o número %s", async (_n, jid) => {
        const res = await call(GOOD, jid);
        expect(res.status).toBe(200);
        expect((server.requests[0].json as { to: string }).to).toBe(PHONE);
    });
    it("não depende da janela de 24 h (ClosedWindowStore do piloto)", async () => {
        expect((await call(GOOD)).status).toBe(200);
    });
});

describe("validação (nada vai para a Meta)", () => {
    it.each([
        ["nome com maiúscula", { ...GOOD, name: "Pedido" }],
        ["nome vazio", { ...GOOD, name: "" }],
        ["sem nome", { languageCode: "pt_BR" }],
        ["idioma inválido", { ...GOOD, languageCode: "português" }],
        ["sem idioma", { name: "x" }],
        ["parâmetro que não é texto", { ...GOOD, bodyParameters: [1, 2] }],
        ["parâmetro vazio", { ...GOOD, bodyParameters: [""] }],
        ["parâmetros demais", { ...GOOD, bodyParameters: Array(21).fill("a") }],
        ["corpo que não é objeto", ["x"]],
    ])("corpo inválido: %s → 400", async (_n, body) => {
        expect((await call(body)).status).toBe(400);
        expect(server.requests).toHaveLength(0);
    });
    it("JSON quebrado → 400", async () => {
        expect((await call(null, PHONE, "{nao é json")).status).toBe(400);
    });
    it.each(["abc", "123", "1".repeat(16), "5561@evil.com", "55 61 99999-9999 ligar", ""])("número inválido %j → 400, sem eco do número", async (jid) => {
        const res = await call(GOOD, jid);
        expect(res.status).toBe(400);
        const text = JSON.stringify(await res.json());
        if (jid.length > 4) expect(text).not.toContain(jid);
        expect(server.requests).toHaveLength(0);
    });
});

describe("sessão e provedor", () => {
    it("sessão fora do ar / Cloud sem credenciais: 503", async () => {
        h.getProvider.mockReturnValue(null);
        expect((await call(GOOD)).status).toBe(503);
    });
    it("sessão Baileys: 501 claro", async () => {
        h.getProvider.mockReturnValue(new BaileysProvider({ sessionId: "s", socket: {} }));
        const res = await call(GOOD);
        expect(res.status).toBe(501);
        expect(await res.json()).toMatchObject({ code: "CAPABILITY_NOT_SUPPORTED", capability: "templates", provider: "baileys" });
    });
});

describe("erros da Meta (classificados, sem token)", () => {
    const cases: [string, number, number, number, string, boolean][] = [
        ["template inexistente (132001)", 400, 132001, 422, "template", false],
        ["não entregável (131026)", 400, 131026, 422, "undeliverable", false],
        ["limite de taxa (130429)", 429, 130429, 429, "rate_limit", true],
        ["token inválido (190)", 400, 190, 502, "auth", false],
        ["erro da Meta (500)", 500, 0, 502, "server", true],
    ];
    it.each(cases)("%s", async (_l, metaStatus, code, httpStatus, kind, retryable) => {
        server.enqueue({ status: metaStatus, body: code ? metaError(code, "falha da Meta", { details: "detalhe", fbtrace_id: "TR1" }) : {} });
        const res = await call(GOOD);
        expect(res.status).toBe(httpStatus);
        expect(await res.json()).toMatchObject({ status: false, code: kind, retryable });
    });
    it("expõe metaCode e fbtraceId para suporte", async () => {
        server.enqueue({ status: 400, body: metaError(132001, "Template name does not exist", { fbtrace_id: "TRACE9" }) });
        const body = await (await call(GOOD)).json();
        expect(body).toMatchObject({ metaCode: 132001, fbtraceId: "TRACE9" });
    });
    it("o token nunca aparece na resposta, em nenhum tipo de erro", async () => {
        const bodies: string[] = [];
        for (const [status, code] of [[400, 132001], [401, 190], [429, 130429], [500, 0]] as [number, number][]) {
            server.enqueue({ status, body: code ? metaError(code, "falha") : {} });
            bodies.push(JSON.stringify(await (await call(GOOD)).json()));
        }
        for (const b of bodies) {
            expect(b).not.toContain(TOKEN);
            expect(b.toLowerCase()).not.toContain("bearer");
        }
    });
});

describe("privacidade do log", () => {
    it("nem telefone, nem valores, nem token vão para o log (sucesso e erro)", async () => {
        await call(GOOD); // sucesso
        server.enqueue({ status: 400, body: metaError(132001, "falha") });
        await call(GOOD); // erro da Meta
        await call(GOOD, "abc"); // número inválido
        const logged = JSON.stringify([h.logger.info.mock.calls, h.logger.warn.mock.calls, h.logger.error.mock.calls]);
        for (const dado of [PHONE, "Maria", "Açaí do Didi", TOKEN, "pedido_em_preparo"]) expect(logged, dado).not.toContain(dado);
        expect(logged).toContain("parametros=3");
        expect(logged).toContain("codigo=132001");
    });
});
