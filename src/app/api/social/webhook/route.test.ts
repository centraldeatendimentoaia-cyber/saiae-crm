import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ socialAccount: { findMany: vi.fn(async () => []) } }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const getUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-auth", () => ({ getAuthenticatedUser: getUser, canAccessSession: vi.fn() }));

import { GET, POST } from "./route";
import { GET as diagnostico } from "../../automacoes/gatilhos/diagnostico/route";

const SECRET = "segredo-de-teste";
const corpo = JSON.stringify({ object: "instagram", entry: [{ id: "IG1", messaging: [{ sender: { id: "U1" }, timestamp: Date.now(), message: { mid: "m1", text: "oi" } }] }] });
const assinar = (c: string) => `sha256=${createHmac("sha256", SECRET).update(c).digest("hex")}`;
const post = (c: string, sig?: string) => new NextRequest("http://x/api/social/webhook", { method: "POST", body: c, headers: sig ? { "x-hub-signature-256": sig } : {} });

beforeEach(() => { process.env.SOCIAL_META_APP_SECRET = SECRET; process.env.SOCIAL_WEBHOOK_VERIFY_TOKEN = "tok"; });
afterEach(() => { delete process.env.SOCIAL_META_APP_SECRET; delete process.env.SOCIAL_WEBHOOK_VERIFY_TOKEN; vi.clearAllMocks(); });

describe("webhook social", () => {
    it("GET: verifica token e devolve o challenge; token errado = 403", async () => {
        const ok = await GET(new NextRequest("http://x/api/social/webhook?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=123"));
        expect(ok.status).toBe(200);
        expect(await ok.text()).toBe("123");
        expect((await GET(new NextRequest("http://x/api/social/webhook?hub.mode=subscribe&hub.verify_token=ruim&hub.challenge=1"))).status).toBe(403);
    });
    it("POST: sem assinatura ou com assinatura errada = 401; sem segredo configurado = 503", async () => {
        expect((await POST(post(corpo))).status).toBe(401);
        expect((await POST(post(corpo, assinar(corpo + "x")))).status).toBe(401);
        delete process.env.SOCIAL_META_APP_SECRET;
        expect((await POST(post(corpo, assinar(corpo)))).status).toBe(503);
    });
    it("POST válido com flags desligadas: 200 e nenhum acesso a banco (evento descartado)", async () => {
        const r = await POST(post(corpo, assinar(corpo)));
        expect(r.status).toBe(200);
        await new Promise((res) => setTimeout(res, 10));
        expect(prismaMock.socialAccount.findMany).not.toHaveBeenCalled();
    });
    it("JSON inválido com assinatura correta = 400", async () => {
        expect((await POST(post("{", assinar("{")))).status).toBe(400);
    });
});

describe("rota de diagnóstico", () => {
    it("exige login", async () => {
        getUser.mockResolvedValue(null);
        expect((await diagnostico(new NextRequest("http://x/api/automacoes/gatilhos/diagnostico"))).status).toBe(401);
    });
    it("lista gatilhos desabilitados com motivo e sem segredos", async () => {
        getUser.mockResolvedValue({ id: "u1", role: "USER" });
        const r = await diagnostico(new NextRequest("http://x/api/automacoes/gatilhos/diagnostico"));
        const j = await r.json();
        expect(j.data.gatilhos).toHaveLength(6);
        expect(j.data.gatilhos.every((g: { estado: string; motivo: string }) => g.estado !== "habilitado" && g.motivo)).toBe(true);
        expect(JSON.stringify(j)).not.toContain(SECRET);
    });
});
