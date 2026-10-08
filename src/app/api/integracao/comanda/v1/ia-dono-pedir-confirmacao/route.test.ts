import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    sendTemplate: vi.fn(),
    provider: null as unknown,
    incrementar: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));
vi.mock("@/modules/ia-atendimento/consumo", async (orig) => ({ ...(await orig<typeof import("@/modules/ia-atendimento/consumo")>()), prismaConsumo: { incrementar: h.incrementar } }));
vi.mock("@/modules/ia-atendimento/registro", () => ({ criarProviderCloud: () => h.provider }));

import { POST } from "./route";
import { proxy } from "@/proxy";

const URL_ROTA = "https://crm.exemplo.test/api/integracao/comanda/v1/ia-dono-pedir-confirmacao";
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
    h.sendTemplate.mockReset().mockResolvedValue({});
    h.incrementar.mockReset().mockResolvedValue(1);
    h.provider = { sendTemplate: h.sendTemplate };
    Object.values(h.logger).forEach((f) => f.mockReset());
});
afterEach(() => vi.unstubAllEnvs());

describe("POST ia-dono-pedir-confirmacao", () => {
    it("assinatura válida: envia o template ao telefone informado e responde enviado:true", async () => {
        const r = await enviar({ codigo_loja: "ABC234", telefone: TEL });
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ enviado: true });
        expect(h.sendTemplate).toHaveBeenCalledWith(TEL, expect.objectContaining({ name: "ia_chamar_dono" }));
    });
    it("com IA_TEMPLATE_CONFIRMAR e nome_loja: usa o template novo", async () => {
        vi.stubEnv("IA_TEMPLATE_CONFIRMAR", "ia_confirmar_responsavel");
        await enviar({ codigo_loja: "ABC234", telefone: TEL, nome_loja: "Açaí do Zé" });
        expect(h.sendTemplate).toHaveBeenCalledWith(TEL, { name: "ia_confirmar_responsavel", languageCode: "pt_BR", bodyParameters: ["Açaí do Zé", "ABC234"] });
    });
    it("acima de 3 pedidos no dia: enviado:false motivo limite, sem template", async () => {
        h.incrementar.mockResolvedValue(4);
        expect(await (await enviar({ codigo_loja: "ABC234", telefone: TEL })).json()).toEqual({ enviado: false, motivo: "limite" });
        expect(h.sendTemplate).not.toHaveBeenCalled();
    });
    it("falha do envio: enviado:false motivo falha_envio", async () => {
        h.sendTemplate.mockRejectedValue(new Error("meta"));
        expect(await (await enviar({ codigo_loja: "ABC234", telefone: TEL })).json()).toEqual({ enviado: false, motivo: "falha_envio" });
    });
    it("Cloud API não configurada: falha_envio", async () => {
        h.provider = null;
        expect(await (await enviar({ codigo_loja: "ABC234", telefone: TEL })).json()).toEqual({ enviado: false, motivo: "falha_envio" });
    });
    it.each([
        ["sem assinatura", () => enviar({ codigo_loja: "ABC234", telefone: TEL }, { sem: ["sig"] })],
        ["sem timestamp", () => enviar({ codigo_loja: "ABC234", telefone: TEL }, { sem: ["ts"] })],
        ["segredo errado", () => enviar({ codigo_loja: "ABC234", telefone: TEL }, { secret: "outro-segredo-com-16-chars+" })],
        ["timestamp velho", () => enviar({ codigo_loja: "ABC234", telefone: TEL }, { ts: now() - 600 })],
    ])("401 sem corpo: %s", async (_n, fazer) => {
        const r = await fazer();
        expect(r.status).toBe(401);
        expect(await r.text()).toBe("");
        expect(h.sendTemplate).not.toHaveBeenCalled();
    });
    it.each([
        [{ codigo_loja: "abc234", telefone: TEL }],
        [{ codigo_loja: "ABC234" }],
        [{ codigo_loja: "ABC234", telefone: "61988887777" }],
        [{ codigo_loja: "ABC234", telefone: "BR.123" }],
        [{ telefone: TEL }],
    ])("400 sem corpo: corpo fora do contrato %j", async (b) => {
        const r = await enviar(b);
        expect(r.status).toBe(400);
        expect(await r.text()).toBe("");
        expect(h.sendTemplate).not.toHaveBeenCalled();
    });
    it("JSON inválido (assinado): 400; corpo grande: 413", async () => {
        expect((await enviar(null, { raw: "{nao-json" })).status).toBe(400);
        expect((await enviar(null, { raw: JSON.stringify({ codigo_loja: "ABC234", telefone: TEL, lixo: "x".repeat(2000) }) })).status).toBe(413);
    });
    it("sem segredo configurado: 503 sem corpo", async () => {
        vi.stubEnv("COMANDA_IA_SEGREDO", "curto");
        const r = await enviar({ codigo_loja: "ABC234", telefone: TEL }, { secret: "curto" });
        expect(r.status).toBe(503);
        expect(await r.text()).toBe("");
    });
    it("nenhum log traz telefone nem código da loja", async () => {
        h.sendTemplate.mockRejectedValue(new Error(`falhou ${TEL}`));
        await enviar({ codigo_loja: "ABC234", telefone: TEL });
        const log = JSON.stringify(Object.values(h.logger).map((f) => f.mock.calls));
        expect(log).not.toContain(TEL);
        expect(log).not.toContain("ABC234");
    });
    it("a rota é pública no proxy", async () => {
        const res = await proxy(new NextRequest(URL_ROTA, { method: "POST" }));
        expect(res.headers.get("location")).toBeNull();
        expect(res.status).toBe(200);
    });
});
