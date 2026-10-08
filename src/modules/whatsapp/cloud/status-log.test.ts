import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/logger", () => ({ logger }));

import { failedStatusLines, safeTitle } from "./status-log";
import { normalizeMetaWebhook } from "./inbound";
import * as fx from "./fixtures";
import { POST } from "@/app/api/whatsapp/webhook/route";

const SECRET = "segredo-de-teste-do-app";
const post = (payload: unknown) => {
    const body = JSON.stringify(payload);
    const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
    return POST(new NextRequest("https://crm.exemplo.test/api/whatsapp/webhook", { method: "POST", body, headers: { "x-hub-signature-256": sig } }));
};

// Falha com dados sensíveis espalhados de propósito: nada disso pode ir para o log.
const failedWithPii = fx.envelope({
    statuses: [{
        id: "wamid.SECRETO123", status: "failed", timestamp: "1750263773", recipient_id: "5561999990001", recipient_user_id: "BR.13491208655302741918",
        conversation: { id: "c1", origin: { type: "utility" } },
        pricing: { billable: true, pricing_model: "CBP", category: "utility" },
        errors: [{ code: 131042, title: "Business eligibility payment issue", message: "ligue para 5561999990001", error_data: { details: "Maria Teste 5561999990001" } }],
    }],
});

beforeEach(() => {
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    Object.values(logger).forEach((f) => f.mockReset());
});
afterEach(() => vi.unstubAllEnvs());

describe("failedStatusLines", () => {
    it("uma linha por falha, com código, título e categoria", () => {
        expect(failedStatusLines(normalizeMetaWebhook(failedWithPii))).toEqual([
            'tipo=status status=failed codigo=131042 titulo="Business eligibility payment issue" categoria=utility',
        ]);
    });
    it("o payload de exemplo de falha (131047, fora da janela)", () => {
        expect(failedStatusLines(normalizeMetaWebhook(fx.statusFailed))).toEqual([
            'tipo=status status=failed codigo=131047 titulo="Re-engagement message" categoria=-',
        ]);
    });
    it("sent, delivered, read e mensagens recebidas não geram linha", () => {
        for (const p of [fx.statusSent, fx.statusDelivered, fx.statusRead, fx.textMessage]) expect(failedStatusLines(normalizeMetaWebhook(p))).toEqual([]);
    });
    it("falha sem erro anexado: código e título '-'", () => {
        const p = fx.envelope({ statuses: [{ id: "w", status: "failed", recipient_id: "5561999990001", timestamp: "1" }] });
        expect(failedStatusLines(normalizeMetaWebhook(p))).toEqual(['tipo=status status=failed codigo=- titulo="-" categoria=-']);
    });
    it("várias falhas no mesmo lote", () => {
        const one = (id: string) => ({ id, status: "failed", recipient_id: "5561999990001", timestamp: "1", errors: [{ code: 131026, title: "Message undeliverable" }] });
        expect(failedStatusLines(normalizeMetaWebhook(fx.envelope({ statuses: [one("a"), one("b")] })))).toHaveLength(2);
    });
});

describe("safeTitle", () => {
    it("corta o tamanho, tira quebras de linha e esconde sequências longas de dígitos", () => {
        expect(safeTitle("a".repeat(200))).toHaveLength(80);
        expect(safeTitle("linha1\nlinha2")).toBe("linha1 linha2");
        expect(safeTitle("falha no 5561999990001 agora")).toBe("falha no # agora");
        expect(safeTitle(null)).toBe("-");
        expect(safeTitle("   ")).toBe("-");
    });
});

describe("webhook: log de status failed", () => {
    it("loga a linha de falha e mantém a linha de contagens", async () => {
        expect((await post(failedWithPii)).status).toBe(200);
        const warns = logger.warn.mock.calls.map((c) => c[1]);
        expect(warns).toContain('tipo=status status=failed codigo=131042 titulo="Business eligibility payment issue" categoria=utility');
        expect(logger.info.mock.calls.map((c) => c[1]).join("|")).toMatch(/mensagens=0 status=1/);
    });
    it("NUNCA telefone, nome, ids, mensagem do erro nem segredo no log", async () => {
        await post(failedWithPii);
        const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
        for (const dado of ["5561999990001", "Maria Teste", "BR.1349", "wamid", "SECRETO123", "ligue para", "eligibility payment issue Maria", SECRET]) {
            expect(logged, dado).not.toContain(dado);
        }
    });
    it("status que não é failed não gera o aviso", async () => {
        await post(fx.statusDelivered);
        expect(logger.warn).not.toHaveBeenCalled();
    });
});
