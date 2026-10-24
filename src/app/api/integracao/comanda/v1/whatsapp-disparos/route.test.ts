import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, executar: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));
vi.mock("@/modules/disparos/campanha", async (orig) => ({
    ...(await orig<typeof import("@/modules/disparos/campanha")>()),
    executarAcaoDisparo: h.executar,
}));

import { POST } from "./route";
import { proxy } from "@/proxy";

const URL_DISPAROS = "https://crm.exemplo.test/api/integracao/comanda/v1/whatsapp-disparos";
const SECRET = "segredo-whatsapp-de-plataforma-16+";
const now = () => Math.floor(Date.now() / 1000);
const sign = (raw: string, ts: string, secret = SECRET) => "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
const body = (over: Record<string, unknown> = {}) => ({ barraca_id: crypto.randomUUID(), acao: "historico", request_id: crypto.randomUUID(), ...over });
const criar = (over: Record<string, unknown> = {}) =>
    body({ acao: "criar", tipo: "promocao", texto: "Oferta!", barraca_nome: "Loja", destinatarios: [{ telefone: "61999990001", nome: null }], ...over });

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
    return POST(new NextRequest(URL_DISPAROS, { method: "POST", body: raw, headers }));
}

beforeEach(() => {
    vi.stubEnv("COMANDA_WHATSAPP_SEGREDO", SECRET);
    Object.values(h.logger).forEach((f) => f.mockReset());
    h.executar.mockReset().mockResolvedValue({ ok: true, campanhas: [], avaliacoes: { media: null, total: 0, enviadas_30d: 0, itens: [] } });
});
afterEach(() => vi.unstubAllEnvs());

describe("whatsapp-disparos: autenticação", () => {
    it("assinatura válida: 200 com a resposta da ação", async () => {
        const b = criar();
        h.executar.mockResolvedValue({ ok: true, campanha_id: "c1", total: 1, invalidos: 0, repetido: false });
        const r = await send(b);
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ ok: true, campanha_id: "c1", total: 1, invalidos: 0, repetido: false });
        expect(h.executar).toHaveBeenCalledWith(b);
    });

    it("recusa de negócio também é 200 com ok:false", async () => {
        h.executar.mockResolvedValue({ ok: false, motivo: "whatsapp_desconectado" });
        const r = await send(criar());
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ ok: false, motivo: "whatsapp_desconectado" });
    });

    it("sem segredo configurado: 503, nunca aceita", async () => {
        vi.stubEnv("COMANDA_WHATSAPP_SEGREDO", "");
        expect((await send(body())).status).toBe(503);
        vi.stubEnv("COMANDA_WHATSAPP_SEGREDO", "curto");
        expect((await send(body())).status).toBe(503);
        expect(h.executar).not.toHaveBeenCalled();
    });

    it("toda falha de autenticação responde 401 com o mesmo corpo", async () => {
        const respostas = await Promise.all([
            send(body(), { secret: "outro-segredo-qualquer-16chars" }),
            send(body(), { ts: now() - 3600 }),
            send(body(), { headers: { "x-saiae-signature": null } }),
            send(body(), { headers: { "x-saiae-timestamp": "abc" } }),
            send(body(), { headers: { "x-saiae-signature": "sha256=zz" } }),
        ]);
        for (const r of respostas) expect(r.status).toBe(401);
        const corpos = await Promise.all(respostas.map((r) => r.text()));
        expect(new Set(corpos).size).toBe(1);
        expect(h.executar).not.toHaveBeenCalled();
    });

    it("aceita o segredo antigo durante a rotação", async () => {
        vi.stubEnv("COMANDA_WHATSAPP_SEGREDO", `${SECRET},segredo-novo-de-plataforma-16+`);
        expect((await send(body())).status).toBe(200);
        expect((await send(body(), { secret: "segredo-novo-de-plataforma-16+" })).status).toBe(200);
    });

    it("é pública no proxy (caminho exato)", async () => {
        const r = await proxy(new NextRequest(URL_DISPAROS, { method: "POST" }));
        expect(r.headers.get("location")).toBeNull();
        const outra = await proxy(new NextRequest(`${URL_DISPAROS}/x`, { method: "POST" }));
        expect(outra.status).not.toBe(200);
    });
});

describe("whatsapp-disparos: contrato", () => {
    it.each([
        ["ação desconhecida", body({ acao: "apagar" })],
        ["barraca_id inválido", body({ barraca_id: "nao-e-uuid" })],
        ["campo extra", body({ extra: 1 })],
        ["destinatarios vazio", criar({ destinatarios: [] })],
        ["501 destinatarios", criar({ destinatarios: Array.from({ length: 501 }, () => ({ telefone: "61999990001", nome: null })) })],
        ["cancelar sem campanha_id", body({ acao: "cancelar" })],
    ])("422 para %s, sem ecoar valores", async (_nome, b) => {
        const r = await send(b);
        expect(r.status).toBe(422);
        expect(await r.text()).not.toContain("apagar");
        expect(h.executar).not.toHaveBeenCalled();
    });

    it("JSON inválido: 400; X-Saiae-Event-Id diferente do request_id: 422", async () => {
        expect((await send(null, { raw: "{não é json" })).status).toBe(400);
        expect((await send(body(), { headers: { "x-saiae-event-id": crypto.randomUUID() } })).status).toBe(422);
        expect(h.executar).not.toHaveBeenCalled();
    });

    it("aceita corpo de 500 destinatários (abaixo de 256 KB)", async () => {
        const dest = Array.from({ length: 500 }, (_, i) => ({ telefone: `6199999${String(i).padStart(4, "0")}`, nome: "Nome Sobrenome" }));
        expect((await send(criar({ destinatarios: dest }))).status).toBe(200);
    });
});

describe("whatsapp-disparos: tamanho, limite e falha", () => {
    it("corpo maior que 256 KB: 413, inclusive por content-length", async () => {
        expect((await send(null, { raw: JSON.stringify({ x: "a".repeat(262_200) }) })).status).toBe(413);
        const b = body();
        const raw = JSON.stringify(b);
        const ts = String(now());
        const r = await POST(
            new NextRequest(URL_DISPAROS, { method: "POST", body: raw, headers: { "content-length": "300000", "x-saiae-timestamp": ts, "x-saiae-signature": sign(raw, ts), "x-saiae-event-id": b.request_id } })
        );
        expect(r.status).toBe(413);
        expect(h.executar).not.toHaveBeenCalled();
    });

    it("mais de 30 chamadas por minuto na mesma loja: 429; outra loja não é afetada", async () => {
        const barraca = crypto.randomUUID();
        let ultimo = 200;
        for (let i = 0; i < 31; i++) ultimo = (await send(body({ barraca_id: barraca }))).status;
        expect(ultimo).toBe(429);
        expect((await send(body())).status).toBe(200);
    });

    it("falha da ação: 502 genérico, log sem dados", async () => {
        h.executar.mockRejectedValue(new Error("baileys 5561999990001"));
        const r = await send(body());
        expect(r.status).toBe(502);
        expect(await r.text()).not.toContain("5561999990001");
        expect(JSON.stringify(h.logger.error.mock.calls)).not.toContain("5561999990001");
    });
});
