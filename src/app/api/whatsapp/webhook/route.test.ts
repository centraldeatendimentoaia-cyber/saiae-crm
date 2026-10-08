import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const { logger, auth } = vi.hoisted(() => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    auth: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger }));
vi.mock("@/lib/auth", () => ({ auth }));

import { GET, POST } from "./route";
import { proxy } from "@/proxy";

const URL_BASE = "https://crm.exemplo.test/api/whatsapp/webhook";
const VERIFY = "token-de-teste-verificacao";
const SECRET = "segredo-de-teste-do-app";

const sign = (body: string, secret = SECRET) => "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

function getReq(qs: Record<string, string>) {
    return new NextRequest(`${URL_BASE}?${new URLSearchParams(qs)}`, { method: "GET" });
}
function postReq(body: string, headers: Record<string, string> = {}) {
    return new NextRequest(URL_BASE, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
}

// Evento com conteúdo sensível de propósito: nada disso pode aparecer em log.
const SENSITIVE_PHONE = "5561999531848";
const SENSITIVE_TEXT = "meu cpf é 123.456.789-00";
const event = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
        {
            id: "WABA123",
            changes: [
                {
                    field: "messages",
                    value: {
                        contacts: [{ wa_id: SENSITIVE_PHONE, profile: { name: "Maria Secreta" } }],
                        messages: [{ from: SENSITIVE_PHONE, id: "wamid.X", type: "text", text: { body: SENSITIVE_TEXT } }],
                        statuses: [{ id: "wamid.Y", status: "delivered", recipient_id: SENSITIVE_PHONE }],
                    },
                },
            ],
        },
    ],
});

beforeEach(() => {
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", VERIFY);
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    Object.values(logger).forEach((f) => f.mockReset());
    auth.mockReset().mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET (verificação)", () => {
    it("token correto: 200 com o challenge em texto puro", async () => {
        const res = await GET(getReq({ "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "1158201444" }));
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("1158201444");
        expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    });
    it("token errado: 403 e não devolve o challenge", async () => {
        const res = await GET(getReq({ "hub.mode": "subscribe", "hub.verify_token": "errado", "hub.challenge": "999" }));
        expect(res.status).toBe(403);
        expect(await res.text()).not.toContain("999");
    });
    it("modo diferente de subscribe: 403", async () => {
        const res = await GET(getReq({ "hub.mode": "unsubscribe", "hub.verify_token": VERIFY, "hub.challenge": "1" }));
        expect(res.status).toBe(403);
    });
    it("sem token ou sem challenge: 403", async () => {
        expect((await GET(getReq({ "hub.mode": "subscribe", "hub.challenge": "1" }))).status).toBe(403);
        expect((await GET(getReq({ "hub.mode": "subscribe", "hub.verify_token": VERIFY }))).status).toBe(403);
    });
    it("variável não configurada: 403 (nunca aceita qualquer token)", async () => {
        vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
        const res = await GET(getReq({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }));
        expect(res.status).toBe(403);
    });
    it("token de tamanho diferente não quebra a comparação", async () => {
        const res = await GET(getReq({ "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "1" }));
        expect(res.status).toBe(403);
    });
});

describe("POST (eventos)", () => {
    it("assinatura válida: 200", async () => {
        const res = await POST(postReq(event, { "x-hub-signature-256": sign(event) }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ received: true });
    });
    it("assinatura inválida: 401", async () => {
        const res = await POST(postReq(event, { "x-hub-signature-256": sign(event, "outro-segredo") }));
        expect(res.status).toBe(401);
    });
    it("sem cabeçalho de assinatura: 401", async () => {
        expect((await POST(postReq(event))).status).toBe(401);
    });
    it("cabeçalho malformado: 401", async () => {
        expect((await POST(postReq(event, { "x-hub-signature-256": "sha256=zzz" }))).status).toBe(401);
        expect((await POST(postReq(event, { "x-hub-signature-256": sign(event).replace("sha256=", "") }))).status).toBe(401);
    });
    it("corpo adulterado depois de assinado: 401", async () => {
        const res = await POST(postReq(event + " ", { "x-hub-signature-256": sign(event) }));
        expect(res.status).toBe(401);
    });
    it("segredo não configurado: 503", async () => {
        vi.stubEnv("WHATSAPP_APP_SECRET", "");
        const res = await POST(postReq(event, { "x-hub-signature-256": sign(event) }));
        expect(res.status).toBe(503);
    });
    it("JSON inválido com assinatura correta: 400", async () => {
        const bad = "{nao é json";
        const res = await POST(postReq(bad, { "x-hub-signature-256": sign(bad) }));
        expect(res.status).toBe(400);
    });
    it("corpo gigante: 413 sem nem validar", async () => {
        const res = await POST(postReq("x".repeat(1_000_001), { "x-hub-signature-256": "sha256=" + "0".repeat(64) }));
        expect(res.status).toBe(413);
    });
    it("registra só tipo e contagem: nenhum telefone, nome ou texto vai para o log", async () => {
        await POST(postReq(event, { "x-hub-signature-256": sign(event) }));
        const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
        expect(logged).toContain("mensagens=1");
        expect(logged).toContain("status=1");
        expect(logged).not.toContain(SENSITIVE_PHONE);
        expect(logged).not.toContain("Maria Secreta");
        expect(logged).not.toContain("cpf");
        expect(logged).not.toContain("wamid");
        expect(logged).not.toContain(SECRET);
        expect(logged).not.toContain(VERIFY);
    });
});

describe("proxy: rota pública", () => {
    it("GET e POST do webhook passam sem login nem chave de API", async () => {
        for (const method of ["GET", "POST"]) {
            const res = await proxy(new NextRequest(URL_BASE, { method }));
            expect(res.status).toBe(200); // NextResponse.next()
            expect(res.headers.get("x-middleware-next")).toBe("1");
        }
    });
    it("outras rotas /api continuam protegidas", async () => {
        const res = await proxy(new NextRequest("https://crm.exemplo.test/api/sessions", { method: "GET" }));
        expect(res.status).toBe(401);
    });
    it("não libera variações do caminho", async () => {
        const res = await proxy(new NextRequest(URL_BASE + "/x", { method: "POST" }));
        expect(res.status).toBe(401);
    });
});
