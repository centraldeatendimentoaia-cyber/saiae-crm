import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { avisarEstadoSessao, segredosWhatsapp } from "./sessao-evento";
import { verifyComandaSignature } from "./signature";

const SEGREDO = "segredo-whatsapp-de-plataforma-16+";
const BARRACA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const env = { COMANDA_WHATSAPP_SEGREDO: SEGREDO, COMANDA_WHATSAPP_EVENTO_URL: "https://x.supabase.co/functions/v1/crm-evento-sessao" };

function deps(fetchImpl: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>) {
    return { fetch: vi.fn(fetchImpl) as never, env, now: () => Date.parse("2026-10-23T12:00:00Z"), sleep: async () => {}, barracaDaSessao: async (s: string) => (s === "sessao-A" ? BARRACA : null) };
}

describe("avisarEstadoSessao", () => {
    it("envia o corpo do contrato assinado com HMAC (verificável pelo mesmo padrão dos eventos)", async () => {
        const d = deps(async () => ({ ok: true, status: 200 }));
        expect(await avisarEstadoSessao("sessao-A", "caiu", d)).toBe(true);
        const [url, init] = (d.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
        const h = init.headers as Record<string, string>;
        const corpo = JSON.parse(init.body as string);
        expect(url).toBe(env.COMANDA_WHATSAPP_EVENTO_URL);
        expect(corpo).toEqual({ barraca_id: BARRACA, estado: "caiu", occurred_at: "2026-10-23T12:00:00.000Z", request_id: expect.any(String) });
        expect(h["x-saiae-event-id"]).toBe(corpo.request_id);
        expect(verifyComandaSignature(Buffer.from(init.body as string), h["x-saiae-timestamp"], h["x-saiae-signature"], [SEGREDO])).toBe(true);
        expect(h["x-saiae-signature"]).toBe("sha256=" + crypto.createHmac("sha256", SEGREDO).update(`${h["x-saiae-timestamp"]}.${init.body}`).digest("hex"));
    });

    it("sessão sem vínculo com barraca (sessão comum do CRM): não envia nada", async () => {
        const d = deps(async () => ({ ok: true, status: 200 }));
        expect(await avisarEstadoSessao("sessao-qualquer", "conectado", d)).toBe(false);
        expect(d.fetch).not.toHaveBeenCalled();
    });

    it("sem URL ou sem segredo: não envia", async () => {
        const d = { ...deps(async () => ({ ok: true, status: 200 })), env: { COMANDA_WHATSAPP_SEGREDO: SEGREDO } };
        expect(await avisarEstadoSessao("sessao-A", "conectado", d)).toBe(false);
        expect(d.fetch).not.toHaveBeenCalled();
    });

    it("erro de rede ou 5xx: tenta 3 vezes e desiste sem lançar", async () => {
        const d = deps(async () => { throw new Error("rede"); });
        expect(await avisarEstadoSessao("sessao-A", "caiu", d)).toBe(false);
        expect(d.fetch).toHaveBeenCalledTimes(3);
        const d5 = deps(async () => ({ ok: false, status: 503 }));
        expect(await avisarEstadoSessao("sessao-A", "caiu", d5)).toBe(false);
        expect(d5.fetch).toHaveBeenCalledTimes(3);
    });

    it("recusa definitiva (4xx): não repete", async () => {
        const d = deps(async () => ({ ok: false, status: 401 }));
        expect(await avisarEstadoSessao("sessao-A", "caiu", d)).toBe(false);
        expect(d.fetch).toHaveBeenCalledTimes(1);
    });
});

describe("segredosWhatsapp", () => {
    it("aceita lista para rotação e ignora segredos curtos", () => {
        expect(segredosWhatsapp({ COMANDA_WHATSAPP_SEGREDO: `${SEGREDO}, curto ,outro-segredo-bem-longo-123` })).toEqual([SEGREDO, "outro-segredo-bem-longo-123"]);
        expect(segredosWhatsapp({})).toEqual([]);
    });
});
