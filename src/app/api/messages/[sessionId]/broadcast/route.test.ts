import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Teste de caracterização do disparo em massa (POST /api/messages/{sessionId}/broadcast).
 * Escrito ANTES de migrar a rota para o WhatsAppProvider: o comportamento observável
 * (o que é enviado, quem é pulado, o que é gravado) não pode mudar.
 */

const h = vi.hoisted(() => ({
    prisma: {
        broadcastLog: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
        broadcastRecipient: { findFirst: vi.fn(), updateMany: vi.fn() },
        scheduledMessage: { createMany: vi.fn() },
        session: { findUnique: vi.fn() },
    },
    socket: { sendMessage: vi.fn(), onWhatsApp: vi.fn() },
    getInstance: vi.fn(),
    getAuthenticatedUser: vi.fn(),
    canAccessSession: vi.fn(),
    assertCanSend: vi.fn(),
    recordMessages: vi.fn(),
    ownerIdOfSession: vi.fn(),
    personalizeFor: vi.fn(),
    resolveSendJid: vi.fn(),
    isOptedOut: vi.fn(),
    resolveMedia: vi.fn(),
    onlyInteractedEnabled: vi.fn(),
    hasInteracted: vi.fn(),
    getSafeMode: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: h.getInstance } }));
vi.mock("@/lib/api-auth", () => ({ getAuthenticatedUser: h.getAuthenticatedUser, canAccessSession: h.canAccessSession }));
vi.mock("@/lib/plans", () => ({
    assertCanSend: h.assertCanSend,
    recordMessages: h.recordMessages,
    ownerIdOfSession: h.ownerIdOfSession,
    PlanError: class PlanError extends Error {},
}));
vi.mock("@/lib/personalize", () => ({ personalizeFor: h.personalizeFor }));
vi.mock("@/lib/wa-jid", () => ({ resolveSendJid: h.resolveSendJid }));
vi.mock("@/lib/optout", () => ({ isOptedOut: h.isOptedOut, withFooter: (t: string) => `${t}\n\nSAIR` }));
vi.mock("@/lib/media", () => ({ resolveMedia: h.resolveMedia }));
vi.mock("@/lib/interaction", () => ({
    onlyInteractedEnabled: h.onlyInteractedEnabled,
    hasInteracted: h.hasInteracted,
    NO_INTERACTION_ERROR: "Sem conversa anterior (modo: só quem já interagiu)",
}));
vi.mock("@/lib/safe-mode", () => ({
    getSafeMode: h.getSafeMode,
    safeGate: () => ({ ok: true }),
    gateMessage: () => "",
    humanDelayMs: () => 0,
    batchPauseMs: () => 0,
    sleepMs: async () => {},
}));

import { POST } from "./route";

const SESSION = "sessao-1";
const J1 = "5561999531848@s.whatsapp.net";
const J2 = "5561988887777@s.whatsapp.net";

const call = (body: unknown) =>
    POST(
        new NextRequest(`https://crm.exemplo.test/api/messages/${SESSION}/broadcast`, { method: "POST", body: JSON.stringify(body) }),
        { params: Promise.resolve({ sessionId: SESSION }) }
    );

/** O disparo roda em segundo plano: espera o registro final. */
async function finished() {
    await vi.waitFor(() => {
        const done = h.prisma.broadcastLog.update.mock.calls.find((c) => c[0]?.data?.completedAt);
        expect(done).toBeTruthy();
    });
    return h.prisma.broadcastLog.update.mock.calls.find((c) => c[0]?.data?.completedAt)![0].data;
}

beforeEach(() => {
    ((globalThis as unknown as { __broadcastRunning?: Map<string, string> }).__broadcastRunning)?.clear();
    Object.values(h.prisma).forEach((m) => Object.values(m).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset()));
    h.socket.sendMessage.mockReset().mockResolvedValue({ key: { id: "ID1" } });
    h.socket.onWhatsApp.mockReset();
    h.getInstance.mockReset().mockReturnValue({ sessionId: SESSION, socket: h.socket });
    h.getAuthenticatedUser.mockReset().mockResolvedValue({ id: "u1", role: "OWNER" });
    h.canAccessSession.mockReset().mockResolvedValue(true);
    h.assertCanSend.mockReset().mockResolvedValue(undefined);
    h.recordMessages.mockReset().mockResolvedValue(undefined);
    h.ownerIdOfSession.mockReset().mockResolvedValue("dono-1");
    h.personalizeFor.mockReset().mockImplementation(async (_s: string, _to: string, text: string) => text);
    h.resolveSendJid.mockReset().mockImplementation(async (_sock: unknown, jid: string) => jid);
    h.isOptedOut.mockReset().mockResolvedValue(false);
    h.resolveMedia.mockReset().mockResolvedValue(Buffer.from("img"));
    h.onlyInteractedEnabled.mockReset().mockResolvedValue(false);
    h.hasInteracted.mockReset().mockResolvedValue(true);
    h.getSafeMode.mockReset().mockResolvedValue(null);
    h.prisma.broadcastLog.create.mockImplementation(async ({ data }: { data: { total: number } }) => ({
        id: "b1", startedAt: new Date(), total: data.total, recipients: [],
    }));
    h.prisma.broadcastLog.findUnique.mockResolvedValue({ status: "running" });
    h.prisma.broadcastLog.update.mockResolvedValue({});
    h.prisma.broadcastRecipient.findFirst.mockResolvedValue(null);
    h.prisma.broadcastRecipient.updateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/messages/{sessionId}/broadcast", () => {
    it("sem login: 401", async () => {
        h.getAuthenticatedUser.mockResolvedValue(null);
        expect((await call({ recipients: [J1], message: "Oi" })).status).toBe(401);
    });

    it("sessão fora do ar: 503 e nada é criado", async () => {
        h.getInstance.mockReturnValue(undefined);
        expect((await call({ recipients: [J1], message: "Oi" })).status).toBe(503);
        expect(h.prisma.broadcastLog.create).not.toHaveBeenCalled();
    });

    it("instância sem socket: 503", async () => {
        h.getInstance.mockReturnValue({ sessionId: SESSION, socket: null });
        expect((await call({ recipients: [J1], message: "Oi" })).status).toBe(503);
    });

    it("já existe disparo em andamento neste número: 409", async () => {
        (globalThis as unknown as { __broadcastRunning: Map<string, string> }).__broadcastRunning ||= new Map();
        (globalThis as unknown as { __broadcastRunning: Map<string, string> }).__broadcastRunning.set(SESSION, "outro");
        const res = await call({ recipients: [J1], message: "Oi" });
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe("BROADCAST_RUNNING");
    });

    it("cota do plano estourada: 402 PLAN_LIMIT", async () => {
        const { PlanError } = await import("@/lib/plans");
        h.assertCanSend.mockRejectedValue(Object.assign(new PlanError("Sem cota"), { name: "PlanError" }));
        const res = await call({ recipients: [J1], message: "Oi" });
        expect(res.status).toBe(402);
        expect((await res.json()).code).toBe("PLAN_LIMIT");
    });

    it("texto: envia { text } ao JID resolvido, grava enviado e conta o consumo do dono", async () => {
        h.resolveSendJid.mockImplementation(async () => "556199531848@s.whatsapp.net"); // 9º dígito corrigido
        const res = await call({ recipients: [J1], message: "Olá!" });
        expect(res.status).toBe(200);
        expect((await res.json()).data).toEqual({ broadcastId: "b1", total: 1 });
        const final = await finished();
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
        expect(h.socket.sendMessage).toHaveBeenCalledWith("556199531848@s.whatsapp.net", { text: "Olá!" });
        expect(h.recordMessages).toHaveBeenCalledWith("dono-1", 1);
        expect(h.prisma.broadcastRecipient.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { broadcastLogId: "b1", jid: J1 }, data: expect.objectContaining({ status: "sent" }) })
        );
        expect(final).toMatchObject({ status: "completed", sent: 1, failed: 0 });
    });

    it("texto personalizado pelo nome do contato", async () => {
        h.personalizeFor.mockImplementation(async (_s: string, _to: string, text: string) => text.replace("{primeironome}", "Maria"));
        await call({ recipients: [J1], message: "Oi, {primeironome}!" });
        await finished();
        expect(h.socket.sendMessage).toHaveBeenCalledWith(J1, { text: "Oi, Maria!" });
    });

    it("imagem: envia { image, caption } com o texto como legenda", async () => {
        await call({ recipients: [J1], message: "Promo", mediaUrl: "/api/uploads/x" });
        await finished();
        expect(h.socket.sendMessage).toHaveBeenCalledWith(J1, { image: Buffer.from("img"), caption: "Promo" });
    });

    it("imagem com texto vazio: sem legenda", async () => {
        h.personalizeFor.mockResolvedValue("");
        await call({ recipients: [J1], message: "x", mediaUrl: "/api/uploads/x" });
        await finished();
        const payload = h.socket.sendMessage.mock.calls[0][1];
        expect(payload.image).toEqual(Buffer.from("img"));
        expect(payload.caption).toBeUndefined();
    });

    it("rodapé de descadastro e versões em rodízio", async () => {
        // Modo Seguro com atraso zero só para o teste não esperar os 2 a 3 s entre envios.
        h.getSafeMode.mockResolvedValue({ delayMinSec: 0, delayMaxSec: 0, batchSize: 0, batchPauseMin: 1, startHour: 0, endHour: 24 });
        await call({ recipients: [J1, J2], message: "A", variants: ["B"], optOutFooter: true });
        await finished();
        expect(h.socket.sendMessage).toHaveBeenNthCalledWith(1, J1, { text: "A\n\nSAIR" });
        expect(h.socket.sendMessage).toHaveBeenNthCalledWith(2, J2, { text: "B\n\nSAIR" });
    });

    it("mesma pessoa com e sem o 9º dígito entra uma vez só", async () => {
        const res = await call({ recipients: [J1, "556199531848@s.whatsapp.net"], message: "Oi" });
        expect((await res.json()).data.total).toBe(1);
        await finished();
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("número sem WhatsApp: não envia, marca falha com a mensagem e não consome cota", async () => {
        h.resolveSendJid.mockRejectedValue(new Error("Número não possui WhatsApp"));
        await call({ recipients: [J1], message: "Oi" });
        const final = await finished();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(h.recordMessages).not.toHaveBeenCalled();
        expect(h.prisma.broadcastRecipient.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ data: { status: "failed", error: "Número não possui WhatsApp" } })
        );
        expect(final).toMatchObject({ sent: 0, failed: 1 });
    });

    it("descadastrado (respondeu SAIR): não envia", async () => {
        h.isOptedOut.mockResolvedValue(true);
        await call({ recipients: [J1], message: "Oi" });
        const final = await finished();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(final).toMatchObject({ sent: 0, failed: 1 });
    });

    it("modo 'só quem já interagiu': quem nunca falou é pulado", async () => {
        h.onlyInteractedEnabled.mockResolvedValue(true);
        h.hasInteracted.mockResolvedValue(false);
        await call({ recipients: [J1], message: "Oi" });
        const final = await finished();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(final).toMatchObject({ sent: 0, failed: 1 });
    });

    it("já recebeu esta mensagem nas últimas 12 h: não envia em dobro", async () => {
        h.prisma.broadcastRecipient.findFirst.mockResolvedValue({ id: 1 });
        await call({ recipients: [J1], message: "Oi" });
        const final = await finished();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(final).toMatchObject({ sent: 0, failed: 1 });
    });

    it("falha em um destinatário não interrompe os outros", async () => {
        h.socket.sendMessage.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ key: { id: "ID2" } });
        h.getSafeMode.mockResolvedValue({ delayMinSec: 0, delayMaxSec: 0, batchSize: 0, batchPauseMin: 1, startHour: 0, endHour: 24 });
        await call({ recipients: [J1, J2], message: "Oi" });
        const final = await finished();
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(2);
        expect(final).toMatchObject({ sent: 1, failed: 1 });
    });

    it("cancelado pelo usuário: para antes de enviar", async () => {
        h.prisma.broadcastLog.findUnique.mockResolvedValue({ status: "cancelled" });
        await call({ recipients: [J1], message: "Oi" });
        const final = await finished();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(final.status).toBe("cancelled");
    });
});
