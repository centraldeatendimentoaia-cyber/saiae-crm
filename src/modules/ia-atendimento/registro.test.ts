import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    prisma: { optOut: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() } },
}));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import { criarEnvioCloud, registrarIaAtendimento } from "./registro";
import { dispatchInbound } from "@/modules/whatsapp/cloud/inbound-handler";
import { normalizeMetaWebhook } from "@/modules/whatsapp/cloud/inbound";
import * as fx from "@/modules/whatsapp/cloud/fixtures";
import { POST } from "@/app/api/whatsapp/webhook/route";

beforeEach(() => {
    delete (globalThis as { __iaAtendimentoRegistrado?: boolean }).__iaAtendimentoRegistrado;
    Object.values(h.logger).forEach((f) => f.mockReset());
});
afterEach(() => vi.unstubAllEnvs());

describe("criarEnvioCloud", () => {
    it("sem credenciais ou sem sessão: null (não envia)", () => {
        expect(criarEnvioCloud({})).toBeNull();
        expect(criarEnvioCloud({ META_WA_ACCESS_TOKEN: "t", META_WA_PHONE_NUMBER_ID: "1" })).toBeNull();
        expect(criarEnvioCloud({ WHATSAPP_CLOUD_SESSION_ID: "pilot" })).toBeNull();
    });
    it("com tudo: devolve a função de envio", () => {
        expect(typeof criarEnvioCloud({ META_WA_ACCESS_TOKEN: "t", META_WA_PHONE_NUMBER_ID: "1", WHATSAPP_CLOUD_SESSION_ID: "pilot" })).toBe("function");
    });
});

describe("registrarIaAtendimento", () => {
    it("IA_ATENDIMENTO ausente ou diferente de on: NÃO registra consumidor nenhum", async () => {
        registrarIaAtendimento({}, {});
        registrarIaAtendimento({}, { IA_ATENDIMENTO: "off" });
        h.prisma.optOut.findUnique.mockClear();
        await dispatchInbound(normalizeMetaWebhook(fx.textMessage));
        expect(h.prisma.optOut.findUnique).not.toHaveBeenCalled();
    });
    it("com on registra uma única vez, mesmo chamado de novo", async () => {
        const enviar = vi.fn().mockRejectedValue(new Error("x"));
        const env = { IA_ATENDIMENTO: "on", WHATSAPP_CLOUD_SESSION_ID: "pilot" };
        vi.stubEnv("IA_ATENDIMENTO", "on");
        vi.stubEnv("WHATSAPP_CLOUD_SESSION_ID", "pilot");
        registrarIaAtendimento({ enviar, store: { registrarMensagem: async () => ({ novo: false, conversa: { id: "c", lojaCodigo: "X", contactKey: "y", estado: "ia", pausadaAte: null } }), lojaDaConversa: async () => null, historico: async () => [], pausar: async () => undefined, retomar: async () => undefined, retomarLoja: async () => 0 } }, env);
        registrarIaAtendimento({ enviar }, env);
        h.prisma.optOut.findUnique.mockResolvedValue(null);
        await dispatchInbound(normalizeMetaWebhook(fx.textMessage));
        expect(h.prisma.optOut.findUnique).toHaveBeenCalledTimes(1); // um consumidor só
    });
});

describe("webhook da Meta (desligado por padrão)", () => {
    it("com IA_ATENDIMENTO ausente o webhook responde 200 e a IA não toca no banco nem envia nada", async () => {
        vi.stubEnv("WHATSAPP_APP_SECRET", "segredo-de-teste-do-app");
        const body = JSON.stringify(fx.textMessage);
        const sig = "sha256=" + crypto.createHmac("sha256", "segredo-de-teste-do-app").update(body).digest("hex");
        const res = await POST(new NextRequest("https://crm.exemplo.test/api/whatsapp/webhook", { method: "POST", body, headers: { "x-hub-signature-256": sig } }));
        expect(res.status).toBe(200);
        await new Promise((r) => setTimeout(r, 20));
        expect(h.prisma.optOut.findUnique).not.toHaveBeenCalled();
    });
});
