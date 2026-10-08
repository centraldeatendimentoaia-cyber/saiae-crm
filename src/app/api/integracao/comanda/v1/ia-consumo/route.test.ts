import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, ler: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));
vi.mock("@/modules/ia-atendimento/consumo", async (orig) => ({ ...(await orig<typeof import("@/modules/ia-atendimento/consumo")>()), prismaConsumo: { ler: h.ler } }));

import { GET } from "./route";
import { proxy } from "@/proxy";
import { limiteConhecido, limparLimitesParaTeste, criarControleLimite, mesSaoPaulo } from "@/modules/ia-atendimento/consumo";

const BASE = "https://crm.exemplo.test/api/integracao/comanda/v1/ia-consumo";
const SECRET = "segredo-ia-com-mais-de-16-chars";
const LOJA = "ABC234";
const now = () => Math.floor(Date.now() / 1000);
const sign = (codigo: string, ts: string, secret = SECRET) => "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${codigo}`).digest("hex");

function chamar(codigo: string | null, o: { ts?: number; secret?: string; sem?: ("ts" | "sig")[]; query?: string } = {}) {
    const ts = String(o.ts ?? now());
    const headers: Record<string, string> = { "x-saiae-timestamp": ts, "x-saiae-signature": sign(codigo ?? "", ts, o.secret) };
    for (const k of o.sem ?? []) delete headers[k === "ts" ? "x-saiae-timestamp" : "x-saiae-signature"];
    const url = o.query ?? (codigo === null ? BASE : `${BASE}?codigo_loja=${encodeURIComponent(codigo)}`);
    return GET(new NextRequest(url, { method: "GET", headers }));
}

beforeEach(() => {
    vi.stubEnv("COMANDA_IA_SEGREDO", SECRET);
    h.ler.mockReset().mockResolvedValue(0);
    Object.values(h.logger).forEach((f) => f.mockReset());
    limparLimitesParaTeste();
});
afterEach(() => vi.unstubAllEnvs());

describe("GET ia-consumo", () => {
    it("assinatura válida: 200 com mes, conversas e limite (null sem limite conhecido)", async () => {
        h.ler.mockResolvedValue(42);
        const r = await chamar(LOJA);
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ mes: mesSaoPaulo(new Date()), conversas: 42, limite: null });
        expect(h.ler).toHaveBeenCalledWith(LOJA, mesSaoPaulo(new Date()));
    });
    it("loja desconhecida: 200 com 0 e null", async () => {
        const r = await chamar("ZZZ999");
        expect(r.status).toBe(200);
        expect(await r.json()).toMatchObject({ conversas: 0, limite: null });
    });
    it("devolve o último limite visto pela IA", async () => {
        const c = criarControleLimite({ store: { conversaNova: async () => false, incrementar: async () => 0, ler: async () => 0 }, avisarDono: async () => undefined });
        await c({ id: "1", lojaCodigo: LOJA, contactKey: "5511999990001", estado: "ia", pausadaAte: null }, { ia: { plano_limite_conversas: 300 } } as never);
        expect(limiteConhecido(LOJA)).toBe(300);
        expect((await (await chamar(LOJA)).json()).limite).toBe(300);
    });
    it.each([
        ["sem assinatura", () => chamar(LOJA, { sem: ["sig"] })],
        ["sem timestamp", () => chamar(LOJA, { sem: ["ts"] })],
        ["segredo errado", () => chamar(LOJA, { secret: "outro-segredo-com-16-chars+" })],
        ["timestamp velho", () => chamar(LOJA, { ts: now() - 600 })],
        ["assinatura de OUTRA loja", async () => { const ts = String(now()); return GET(new NextRequest(`${BASE}?codigo_loja=${LOJA}`, { headers: { "x-saiae-timestamp": ts, "x-saiae-signature": sign("ZZZ999", ts) } })); }],
    ])("401 sem corpo: %s", async (_n, fazer) => {
        const r = await fazer();
        expect(r.status).toBe(401);
        expect(await r.text()).toBe("");
        expect(h.ler).not.toHaveBeenCalled();
    });
    it.each(["abc234", "", "ABC23", "ABC2345", "AB C23", "ABC23!"])("código inválido (%s) com assinatura correta: 400 sem corpo", async (cod) => {
        const r = await chamar(cod);
        expect(r.status).toBe(400);
        expect(await r.text()).toBe("");
    });
    it("rotação: aceita qualquer segredo da lista", async () => {
        vi.stubEnv("COMANDA_IA_SEGREDO", `${SECRET}, segredo-antigo-com-16-chars`);
        expect((await chamar(LOJA)).status).toBe(200);
        expect((await chamar(LOJA, { secret: "segredo-antigo-com-16-chars" })).status).toBe(200);
    });
    it("sem segredo configurado (ou curto): 503 sem corpo, nunca aceita", async () => {
        vi.stubEnv("COMANDA_IA_SEGREDO", "curto");
        const r = await chamar(LOJA, { secret: "curto" });
        expect(r.status).toBe(503);
        expect(await r.text()).toBe("");
    });
    it("erro do banco: 500 sem corpo e sem o código da loja no log", async () => {
        h.ler.mockRejectedValue(new Error(`falha ${LOJA}`));
        const r = await chamar(LOJA);
        expect(r.status).toBe(500);
        expect(JSON.stringify(Object.values(h.logger).map((f) => f.mock.calls))).not.toContain(LOJA);
    });
    it("a rota é pública no proxy (passa sem sessão)", async () => {
        const res = await proxy(new NextRequest(`${BASE}?codigo_loja=${LOJA}`));
        expect(res.status).toBe(200);
        expect(res.headers.get("location")).toBeNull();
    });
});
