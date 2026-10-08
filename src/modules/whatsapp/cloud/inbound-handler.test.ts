import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/logger", () => ({ logger }));

import { dispatchInbound, registerInboundConsumer } from "./inbound-handler";
import { normalizeMetaWebhook, type InboundMessage, type NormalizedBatch } from "./inbound";
import * as fx from "./fixtures";
import { POST } from "@/app/api/whatsapp/webhook/route";

const SECRET = "segredo-de-teste-do-app";
const sign = (body: string) => "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
const post = (payload: unknown) => {
    const body = JSON.stringify(payload);
    return POST(new NextRequest("https://crm.exemplo.test/api/whatsapp/webhook", { method: "POST", body, headers: { "x-hub-signature-256": sign(body), "content-type": "application/json" } }));
};

const unregister: (() => void)[] = [];
const register = (c: Parameters<typeof registerInboundConsumer>[0]) => {
    const off = registerInboundConsumer(c);
    unregister.push(off);
    return off;
};

beforeEach(() => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    Object.values(logger).forEach((f) => f.mockReset());
});
afterEach(() => {
    unregister.splice(0).forEach((off) => off());
    vi.unstubAllEnvs();
});

describe("dispatchInbound", () => {
    it("sem consumidor registrado: não faz nada e não falha", async () => {
        await expect(dispatchInbound(normalizeMetaWebhook(fx.textMessage))).resolves.toBeUndefined();
        expect(logger.error).not.toHaveBeenCalled();
    });
    it("entrega o lote a todos os consumidores", async () => {
        const a = vi.fn();
        const b = vi.fn();
        register(a);
        register(b);
        const batch = normalizeMetaWebhook(fx.mixedBatch);
        await dispatchInbound(batch);
        expect(a).toHaveBeenCalledWith(batch);
        expect(b).toHaveBeenCalledWith(batch);
    });
    it("lote sem eventos não chama ninguém", async () => {
        const a = vi.fn();
        register(a);
        await dispatchInbound({ events: [], ignored: 3 });
        expect(a).not.toHaveBeenCalled();
    });
    it("consumidor que falha não derruba os outros e o log não traz o conteúdo", async () => {
        const ok = vi.fn();
        register(() => {
            throw new Error("falha com telefone 5561999990001 e texto Tem açaí");
        });
        register(ok);
        await expect(dispatchInbound(normalizeMetaWebhook(fx.textMessage))).resolves.toBeUndefined();
        expect(ok).toHaveBeenCalledTimes(1);
        const logged = JSON.stringify(logger.error.mock.calls);
        expect(logged).toContain("consumidor falhou");
        expect(logged).not.toContain("5561999990001");
        expect(logged).not.toContain("açaí");
    });
    it("consumidor assíncrono que rejeita também é isolado", async () => {
        const ok = vi.fn();
        register(async () => {
            throw new Error("boom");
        });
        register(ok);
        await dispatchInbound(normalizeMetaWebhook(fx.textMessage));
        expect(ok).toHaveBeenCalled();
    });
    it("remover o consumidor o desliga", async () => {
        const a = vi.fn();
        const off = register(a);
        off();
        await dispatchInbound(normalizeMetaWebhook(fx.textMessage));
        expect(a).not.toHaveBeenCalled();
    });
});

describe("webhook da Meta → normalizador → consumidores", () => {
    it("entrega ao consumidor os eventos normalizados e responde 200", async () => {
        const got: NormalizedBatch[] = [];
        register((b) => {
            got.push(b);
        });
        const res = await post(fx.textMessage);
        expect(res.status).toBe(200);
        await vi.waitFor(() => expect(got).toHaveLength(1));
        const m = got[0].events[0] as InboundMessage;
        expect(m).toMatchObject({ kind: "message", type: "text", text: "Tem açaí de 500ml?", from: { phone: "5561999990001", contactKey: "5561999990001" } });
    });
    it("mensagens e status do mesmo POST chegam juntos", async () => {
        const got: NormalizedBatch[] = [];
        register((b) => {
            got.push(b);
        });
        await post(fx.mixedBatch);
        await vi.waitFor(() => expect(got).toHaveLength(1));
        expect(got[0].events.map((e) => e.kind)).toEqual(["message", "message", "status"]);
    });
    it("responde 200 sem esperar um consumidor lento", async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>((r) => (release = r));
        let finished = false;
        register(async () => {
            await gate;
            finished = true;
        });
        const res = await post(fx.textMessage);
        expect(res.status).toBe(200);
        expect(finished).toBe(false); // a resposta saiu antes de o consumidor terminar
        release();
        await vi.waitFor(() => expect(finished).toBe(true));
    });
    it("consumidor que falha não vira erro para a Meta (ela reentregaria o lote)", async () => {
        register(() => {
            throw new Error("boom");
        });
        const res = await post(fx.textMessage);
        expect(res.status).toBe(200);
    });
    it("assinatura inválida: nada é normalizado nem entregue", async () => {
        const c = vi.fn();
        register(c);
        const body = JSON.stringify(fx.textMessage);
        const res = await POST(new NextRequest("https://crm.exemplo.test/api/whatsapp/webhook", { method: "POST", body, headers: { "x-hub-signature-256": sign(body + "x") } }));
        expect(res.status).toBe(401);
        await new Promise((r) => setTimeout(r, 20));
        expect(c).not.toHaveBeenCalled();
    });
    it("sem consumidores (estado atual): 200 e nenhum telefone, nome ou texto no log", async () => {
        const res = await post(fx.textMessage);
        expect(res.status).toBe(200);
        await new Promise((r) => setTimeout(r, 20));
        const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
        expect(logged).toContain("mensagens=1");
        for (const secret of ["5561999990001", "Maria Teste", "açaí", "wamid", SECRET]) expect(logged).not.toContain(secret);
    });
    it("payload sem eventos úteis (campo de outro tipo): 200 e nenhum consumidor chamado", async () => {
        const c = vi.fn();
        register(c);
        expect((await post(fx.otherField)).status).toBe(200);
        await new Promise((r) => setTimeout(r, 20));
        expect(c).not.toHaveBeenCalled();
    });
});
