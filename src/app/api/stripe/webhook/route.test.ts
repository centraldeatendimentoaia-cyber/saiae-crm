import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const { auth, handleStripeEvent } = vi.hoisted(() => ({
    auth: vi.fn(),
    handleStripeEvent: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/stripe-billing", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/stripe-billing")>()),
    handleStripeEvent,
}));

import { POST } from "./route";
import { proxy } from "@/proxy";

const BASE = "https://crm.exemplo.test";
const WEBHOOK = `${BASE}/api/stripe/webhook`;
const SECRET = "whsec_segredo_de_teste";
const body = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated", data: { object: {} } });

function stripeHeader(raw: string, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
    const v1 = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
    return `t=${t},v1=${v1}`;
}
const post = (raw: string, sig?: string) =>
    new NextRequest(WEBHOOK, { method: "POST", body: raw, headers: sig ? { "stripe-signature": sig } : {} });

beforeEach(() => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    handleStripeEvent.mockReset().mockResolvedValue(undefined);
    auth.mockReset().mockResolvedValue(null); // ninguém logado: é o caso da Stripe
});
afterEach(() => vi.unstubAllEnvs());

describe("proxy: /api/stripe/webhook", () => {
    it("passa pelo proxy sem sessão nem chave de API (a Stripe não tem login)", async () => {
        const res = await proxy(new NextRequest(WEBHOOK, { method: "POST" }));
        expect(res.status).toBe(200);
        expect(res.headers.get("x-middleware-next")).toBe("1");
    });
    it("outras rotas /api/stripe/* continuam exigindo sessão", async () => {
        for (const path of ["/api/stripe/portal", "/api/stripe/webhook/extra", "/api/stripe/webhooks", "/api/stripe"]) {
            const res = await proxy(new NextRequest(BASE + path, { method: "POST" }));
            expect(res.status, path).toBe(401);
        }
    });
    it("com sessão válida, outras rotas passam normalmente", async () => {
        auth.mockResolvedValue({ user: { id: "u1" } });
        const res = await proxy(new NextRequest(`${BASE}/api/stripe/portal`, { method: "POST" }));
        expect(res.headers.get("x-middleware-next")).toBe("1");
    });
});

describe("POST /api/stripe/webhook (a rota)", () => {
    it("assinatura válida: 200 e processa o evento", async () => {
        const res = await POST(post(body, stripeHeader(body)));
        expect(res.status).toBe(200);
        expect(handleStripeEvent).toHaveBeenCalledTimes(1);
    });
    it("assinatura de outro segredo: 400 e não processa", async () => {
        const res = await POST(post(body, stripeHeader(body, "whsec_outro")));
        expect(res.status).toBe(400);
        expect(handleStripeEvent).not.toHaveBeenCalled();
    });
    it("sem cabeçalho de assinatura: 400", async () => {
        expect((await POST(post(body))).status).toBe(400);
        expect(handleStripeEvent).not.toHaveBeenCalled();
    });
    it("corpo alterado depois de assinado: 400", async () => {
        const res = await POST(post(body + " ", stripeHeader(body)));
        expect(res.status).toBe(400);
        expect(handleStripeEvent).not.toHaveBeenCalled();
    });
    it("assinatura antiga (fora da tolerância de 5 min): 400", async () => {
        const old = Math.floor(Date.now() / 1000) - 3600;
        expect((await POST(post(body, stripeHeader(body, SECRET, old)))).status).toBe(400);
    });
    it("segredo não configurado: 503", async () => {
        vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
        expect((await POST(post(body, stripeHeader(body)))).status).toBe(503);
    });
    it("erro ao processar: 500 (a Stripe tenta de novo)", async () => {
        handleStripeEvent.mockRejectedValue(new Error("falha"));
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect((await POST(post(body, stripeHeader(body)))).status).toBe(500);
    });
});
