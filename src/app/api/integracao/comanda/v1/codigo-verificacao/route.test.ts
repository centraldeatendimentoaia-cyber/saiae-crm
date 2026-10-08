import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, getProvider: vi.fn(), sendTemplate: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));
vi.mock("@/modules/whatsapp/provider", async (orig) => ({ ...(await orig<typeof import("@/modules/whatsapp/provider")>()), getProvider: h.getProvider }));

import { POST } from "./route";
import { proxy } from "@/proxy";
import { resetarEnviadosParaTeste, validarPedidoCodigo } from "@/modules/integracao/comanda/codigo";
import { CloudApiError } from "@/modules/whatsapp/cloud/errors";

const URL_CODIGO = "https://crm.exemplo.test/api/integracao/comanda/v1/codigo-verificacao";
const SECRET = "segredo-de-plataforma-com-16-chars+";
const TEL = "61999990001";
const COD = "483920";
const now = () => Math.floor(Date.now() / 1000);
const sign = (raw: string, ts: string, secret = SECRET) => "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
const body = (over: Record<string, unknown> = {}) => ({ barraca_id: crypto.randomUUID(), telefone: TEL, codigo: COD, request_id: crypto.randomUUID(), ...over });

interface O { ts?: number; secret?: string; headers?: Record<string, string | null>; raw?: string }
function send(b: Record<string, unknown> | null, o: O = {}) {
    const raw = o.raw ?? JSON.stringify(b);
    const ts = String(o.ts ?? now());
    const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-saiae-timestamp": ts,
        "x-saiae-signature": sign(raw, ts, o.secret),
        "x-saiae-event-id": String(b?.request_id ?? ""),
    };
    for (const [k, v] of Object.entries(o.headers ?? {})) {
        if (v === null) delete headers[k];
        else headers[k] = v;
    }
    return POST(new NextRequest(URL_CODIGO, { method: "POST", body: raw, headers }));
}

beforeEach(() => {
    vi.stubEnv("COMANDA_CODIGO_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_CLOUD_SESSION_ID", "pilot");
    resetarEnviadosParaTeste();
    Object.values(h.logger).forEach((f) => f.mockReset());
    h.sendTemplate.mockReset().mockResolvedValue({ messageId: "wamid.X" });
    h.getProvider.mockReset().mockReturnValue({ name: "cloud-api", capabilities: { templates: true }, sendTemplate: h.sendTemplate });
});
afterEach(() => vi.unstubAllEnvs());

describe("configuração", () => {
    it.each([["ausente", ""], ["curto demais", "curto"]])("COMANDA_CODIGO_SECRET %s: 503, nunca aceita sem segredo", async (_n, v) => {
        vi.stubEnv("COMANDA_CODIGO_SECRET", v);
        expect((await send(body())).status).toBe(503);
        expect(h.sendTemplate).not.toHaveBeenCalled();
    });
});

describe("autenticação (401 idêntico em todos os casos)", () => {
    it.each([
        ["sem assinatura", { headers: { "x-saiae-signature": null } }],
        ["sem timestamp", { headers: { "x-saiae-timestamp": null } }],
        ["timestamp que não é número", { headers: { "x-saiae-timestamp": "ontem" } }],
        ["assinatura de outro segredo", { secret: "outro-segredo-qualquer-longo" }],
        ["timestamp velho (-301 s)", { ts: now() - 301 }],
        ["timestamp futuro (+301 s)", { ts: now() + 301 }],
        ["assinatura malformada", { headers: { "x-saiae-signature": "sha256=zzz" } }],
    ])("%s", async (_n, o) => {
        const res = await send(body(), o as O);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "Não autorizado" });
        expect(h.sendTemplate).not.toHaveBeenCalled();
    });
    it("dentro da janela (±299 s) passa", async () => {
        expect((await send(body(), { ts: now() - 299 })).status).toBe(200);
        expect((await send(body(), { ts: now() + 299 })).status).toBe(200);
    });
    it("corpo adulterado depois de assinado: 401", async () => {
        const b = body();
        const raw = JSON.stringify(b);
        const ts = String(now());
        const res = await POST(
            new NextRequest(URL_CODIGO, { method: "POST", body: raw.replace(COD, "999999"), headers: { "x-saiae-timestamp": ts, "x-saiae-signature": sign(raw, ts), "x-saiae-event-id": b.request_id } })
        );
        expect(res.status).toBe(401);
    });
    it("rotação: o segredo novo e o antigo valem juntos", async () => {
        vi.stubEnv("COMANDA_CODIGO_SECRET", `novo-segredo-com-mais-de-16-chars, ${SECRET}`);
        expect((await send(body(), { secret: SECRET })).status).toBe(200);
        expect((await send(body(), { secret: "novo-segredo-com-mais-de-16-chars" })).status).toBe(200);
    });
});

describe("formato (422 sem ecoar telefone nem código)", () => {
    it.each([
        ["telefone com 9 dígitos", { telefone: "619999900" }],
        ["telefone com 12 dígitos", { telefone: "556199999000" }],
        ["telefone com máscara", { telefone: "(61) 99999-0001" }],
        ["telefone com letras", { telefone: "6199999abcd" }],
        ["código de 5 dígitos", { codigo: "12345" }],
        ["código de 7 dígitos", { codigo: "1234567" }],
        ["código com letras", { codigo: "12a456" }],
        ["código como número", { codigo: 483920 }],
        ["request_id que não é uuid", { request_id: "abc" }],
        ["barraca_id que não é uuid", { barraca_id: "x" }],
        ["campo extra", { extra: 1 }],
    ] as [string, Record<string, unknown>][])("%s", async (_n, over) => {
        const b = body(over);
        const res = await send(b, { headers: { "x-saiae-event-id": String(b.request_id) } });
        expect(res.status).toBe(422);
        const text = JSON.stringify(await res.json());
        expect(text).not.toContain(String(over.telefone ?? TEL));
        expect(text).not.toContain(String(over.codigo ?? COD));
        expect(h.sendTemplate).not.toHaveBeenCalled();
    });
    it("campo obrigatório ausente: 422", async () => {
        const b = body();
        delete (b as Record<string, unknown>).codigo;
        expect((await send(b)).status).toBe(422);
    });
    it("X-Saiae-Event-Id diferente do request_id: 422", async () => {
        expect((await send(body(), { headers: { "x-saiae-event-id": crypto.randomUUID() } })).status).toBe(422);
    });
    it("JSON inválido com assinatura correta: 400", async () => {
        expect((await send(null, { raw: "{nao json" })).status).toBe(400);
    });
    it("corpo acima de 4 KB: 413", async () => {
        expect((await send(null, { raw: "x".repeat(4097) })).status).toBe(413);
    });
    it("validarPedidoCodigo aceita telefone de 10 e 11 dígitos", () => {
        expect(validarPedidoCodigo(body({ telefone: "6133445566" })).ok).toBe(true);
        expect(validarPedidoCodigo(body({ telefone: "61999990001" })).ok).toBe(true);
    });
});

describe("envio", () => {
    it("caminho feliz: template codigo_verificacao pt_BR, código no corpo e no botão, para 55 + telefone", async () => {
        const res = await send(body());
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ enviado: true });
        expect(h.getProvider).toHaveBeenCalledWith("pilot");
        expect(h.sendTemplate).toHaveBeenCalledTimes(1);
        expect(h.sendTemplate).toHaveBeenCalledWith(`55${TEL}`, { name: "codigo_verificacao", languageCode: "pt_BR", bodyParameters: [COD], buttonParameters: [COD] });
    });
    it("usa a primeira sessão da lista", async () => {
        vi.stubEnv("WHATSAPP_CLOUD_SESSION_ID", " a , b");
        await send(body());
        expect(h.getProvider).toHaveBeenCalledWith("a");
    });
    it.each([["sem WHATSAPP_CLOUD_SESSION_ID", ""], ["sessão sem provedor", "pilot"]])("%s: 503, nunca cai para outro canal", async (_n, session) => {
        vi.stubEnv("WHATSAPP_CLOUD_SESSION_ID", session);
        if (session) h.getProvider.mockReturnValue(null);
        expect((await send(body())).status).toBe(503);
        expect(h.sendTemplate).not.toHaveBeenCalled();
    });
    it("provedor Baileys (sem template): 503", async () => {
        h.getProvider.mockReturnValue({ name: "baileys", capabilities: { templates: false } });
        expect((await send(body())).status).toBe(503);
    });
});

describe("idempotência por request_id", () => {
    it("repetição: 200 duplicate e NÃO envia de novo", async () => {
        const b = body();
        expect(await (await send(b)).json()).toEqual({ enviado: true });
        expect(await (await send(b)).json()).toEqual({ enviado: true, duplicate: true });
        expect(h.sendTemplate).toHaveBeenCalledTimes(1);
    });
    it("request_id diferente é outro pedido", async () => {
        await send(body());
        await send(body());
        expect(h.sendTemplate).toHaveBeenCalledTimes(2);
    });
    it("falha de envio NÃO marca como enviado: a Comanda pode tentar de novo", async () => {
        h.sendTemplate.mockRejectedValueOnce(new CloudApiError("undeliverable", "x", { code: 131026 }));
        const b = body();
        expect((await send(b)).status).toBe(422);
        expect((await send(b)).status).toBe(200);
        expect(h.sendTemplate).toHaveBeenCalledTimes(2);
    });
});

describe("erros da Meta", () => {
    it.each([
        ["undeliverable", 422],
        ["template", 422],
        ["invalid_request", 422],
        ["unsupported", 422],
        ["rate_limit", 429],
        ["auth", 502],
        ["network", 502],
        ["server", 502],
    ] as const)("%s → %i, sem vazar o número", async (kind, status) => {
        h.sendTemplate.mockRejectedValue(new CloudApiError(kind, `falha com ${TEL} e ${COD}`, { code: 131026, details: TEL }));
        const res = await send(body());
        expect(res.status).toBe(status);
        const text = JSON.stringify(await res.json());
        expect(text).not.toContain(TEL);
        expect(text).not.toContain(COD);
    });
    it("erro que não é da Meta: 502", async () => {
        h.sendTemplate.mockRejectedValue(new Error("boom"));
        expect((await send(body())).status).toBe(502);
    });
});

describe("privacidade do log", () => {
    it("nunca telefone, código nem segredo em nenhum caminho", async () => {
        const b = body();
        await send(b);
        await send(b);
        h.sendTemplate.mockRejectedValueOnce(new CloudApiError("undeliverable", `falha ${TEL} ${COD}`, { code: 131026, details: TEL }));
        await send(body());
        h.sendTemplate.mockRejectedValueOnce(new Error(`inesperado ${TEL} ${COD}`));
        await send(body());
        await send(body(), { secret: "segredo-errado-qualquer-longo" });
        await send(body({ telefone: "123" }));
        const logged = JSON.stringify([h.logger.info.mock.calls, h.logger.warn.mock.calls, h.logger.error.mock.calls]);
        for (const dado of [TEL, COD, SECRET, `55${TEL}`]) expect(logged, dado).not.toContain(dado);
        expect(logged).toContain("código enviado");
        expect(logged).toContain("duplicado");
    });
});

describe("proxy", () => {
    it("o caminho exato é público", async () => {
        const res = await proxy(new NextRequest(URL_CODIGO, { method: "POST" }));
        expect(res.headers.get("x-middleware-next")).toBe("1");
    });
    it("variações do caminho continuam exigindo sessão", async () => {
        for (const p of ["/api/integracao/comanda/v1/codigo-verificacao/x", "/api/integracao/comanda/v2/codigo-verificacao", "/api/integracao/comanda/v1/codigo"]) {
            expect((await proxy(new NextRequest("https://crm.exemplo.test" + p, { method: "POST" }))).status, p).toBe(401);
        }
    });
});
