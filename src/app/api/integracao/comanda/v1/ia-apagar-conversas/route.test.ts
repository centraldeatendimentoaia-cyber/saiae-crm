import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, deleteMany: vi.fn(), leadDeleteMany: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/prisma", () => ({ prisma: { iaConversa: { deleteMany: h.deleteMany }, iaLead: { deleteMany: h.leadDeleteMany } } }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import { POST } from "./route";
import { proxy } from "@/proxy";

const URL_ROTA = "https://crm.exemplo.test/api/integracao/comanda/v1/ia-apagar-conversas";
const SECRET = "segredo-ia-com-mais-de-16-chars";
const TEL = "5561988887777";
const now = () => Math.floor(Date.now() / 1000);
const sign = (raw: string, ts: string, secret = SECRET) => "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");

function enviar(b: Record<string, unknown> | null, o: { ts?: number; secret?: string; raw?: string; sem?: ("ts" | "sig")[] } = {}) {
    const raw = o.raw ?? JSON.stringify(b);
    const ts = String(o.ts ?? now());
    const headers: Record<string, string> = { "content-type": "application/json", "x-saiae-timestamp": ts, "x-saiae-signature": sign(raw, ts, o.secret) };
    for (const k of o.sem ?? []) delete headers[k === "ts" ? "x-saiae-timestamp" : "x-saiae-signature"];
    return POST(new NextRequest(URL_ROTA, { method: "POST", body: raw, headers }));
}

beforeEach(() => {
    vi.stubEnv("COMANDA_IA_SEGREDO", SECRET);
    h.deleteMany.mockReset().mockResolvedValue({ count: 3 });
    h.leadDeleteMany.mockReset().mockResolvedValue({ count: 1 });
    Object.values(h.logger).forEach((f) => f.mockReset());
});
afterEach(() => vi.unstubAllEnvs());

describe("POST ia-apagar-conversas", () => {
    it("assinatura válida: apaga e devolve a contagem", async () => {
        const r = await enviar({ codigo_loja: "ABC234", telefone: TEL });
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ apagadas: 3 });
        const where = h.deleteMany.mock.calls[0][0].where;
        expect(where.lojaCodigo.in).toEqual(["ABC234", "SEM-LOJA"]);
        expect(where.contactKey.in).toEqual(expect.arrayContaining([TEL, "556188887777"]));
    });
    it("sem telefone: apaga TODAS as conversas da loja (exclusão de conta), só dela", async () => {
        const r = await enviar({ codigo_loja: "ABC234" });
        expect(await r.json()).toEqual({ apagadas: 3 });
        expect(h.deleteMany).toHaveBeenCalledWith({ where: { lojaCodigo: "ABC234" } });
    });
    it("com telefone: apaga também o lead de vendas do mesmo número; sem telefone (loja inteira) não mexe em leads", async () => {
        await enviar({ codigo_loja: "ABC234", telefone: TEL });
        expect(h.leadDeleteMany.mock.calls[0][0].where.contactKey.in).toEqual(expect.arrayContaining([TEL, "556188887777"]));
        h.leadDeleteMany.mockClear();
        await enviar({ codigo_loja: "ABC234" });
        expect(h.leadDeleteMany).not.toHaveBeenCalled();
    });
    it("idempotente: nada para apagar também é 200", async () => {
        h.deleteMany.mockResolvedValue({ count: 0 });
        expect(await (await enviar({ codigo_loja: "ABC234", telefone: TEL })).json()).toEqual({ apagadas: 0 });
    });
    it.each([
        ["sem assinatura", () => enviar({ codigo_loja: "ABC234", telefone: TEL }, { sem: ["sig"] })],
        ["sem timestamp", () => enviar({ codigo_loja: "ABC234", telefone: TEL }, { sem: ["ts"] })],
        ["segredo errado", () => enviar({ codigo_loja: "ABC234", telefone: TEL }, { secret: "outro-segredo-com-16-chars+" })],
        ["timestamp velho", () => enviar({ codigo_loja: "ABC234", telefone: TEL }, { ts: now() - 600 })],
    ])("401 sem corpo e nada apagado: %s", async (_n, fazer) => {
        const r = await fazer();
        expect(r.status).toBe(401);
        expect(await r.text()).toBe("");
        expect(h.deleteMany).not.toHaveBeenCalled();
    });
    it.each([
        [{ codigo_loja: "abc234", telefone: TEL }],
        [{ codigo_loja: "ABC234", telefone: "" }],
        [{ codigo_loja: "ABC234", telefone: null }],
        [{ codigo_loja: "ABC234", telefone: "BR.123" }],
        [{ codigo_loja: "ABC234", telefone: "12345678901234" }],
    ])("400 sem corpo: %j", async (b) => {
        const r = await enviar(b);
        expect(r.status).toBe(400);
        expect(await r.text()).toBe("");
        expect(h.deleteMany).not.toHaveBeenCalled();
    });
    it("JSON inválido: 400; corpo grande: 413; sem segredo: 503", async () => {
        expect((await enviar(null, { raw: "{x" })).status).toBe(400);
        expect((await enviar(null, { raw: JSON.stringify({ lixo: "x".repeat(2000) }) })).status).toBe(413);
        vi.stubEnv("COMANDA_IA_SEGREDO", "curto");
        expect((await enviar({ codigo_loja: "ABC234", telefone: TEL }, { secret: "curto" })).status).toBe(503);
    });
    it("erro do banco: 500 sem corpo e log sem telefone nem código", async () => {
        h.deleteMany.mockRejectedValue(new Error(`falha ${TEL}`));
        const r = await enviar({ codigo_loja: "ABC234", telefone: TEL });
        expect(r.status).toBe(500);
        const log = JSON.stringify(Object.values(h.logger).map((f) => f.mock.calls));
        expect(log).not.toContain(TEL);
        expect(log).not.toContain("ABC234");
    });
    it("a rota é pública no proxy", async () => {
        const res = await proxy(new NextRequest(URL_ROTA, { method: "POST" }));
        expect(res.headers.get("location")).toBeNull();
    });
});
