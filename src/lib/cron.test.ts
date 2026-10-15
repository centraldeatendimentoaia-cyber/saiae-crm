import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Teste de caracterização do agendador (src/lib/cron.ts), um dos pontos de envio do CRM.
 * Serve de rede de segurança para a introdução do WhatsAppProvider (SAI-003): o comportamento
 * observável (o que é enviado, quando pula, o que marca como SENT/FAILED) não pode mudar.
 */

const h = vi.hoisted(() => {
    const state: { tick: null | (() => Promise<void>) } = { tick: null };
    return {
        state,
        schedule: vi.fn((_expr: string, fn: () => Promise<void>) => {
            state.tick = fn;
        }),
        prisma: {
            broadcastLog: { updateMany: vi.fn() },
            scheduledMessage: { findMany: vi.fn(), update: vi.fn() },
        },
        socket: { sendMessage: vi.fn() },
        getInstance: vi.fn(),
        assertCanSend: vi.fn(),
        recordMessages: vi.fn(),
        isOptedOut: vi.fn(),
        onlyInteractedEnabled: vi.fn(),
        hasInteracted: vi.fn(),
        getSafeMode: vi.fn(),
        safeGate: vi.fn(),
        resolveMedia: vi.fn(),
    };
});

vi.mock("node-cron", () => ({ default: { schedule: h.schedule } }));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: h.getInstance } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/job-lock", () => ({ withJobLock: (_n: string, _t: number, fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/plans", () => ({ assertCanSend: h.assertCanSend, recordMessages: h.recordMessages }));
vi.mock("@/lib/optout", () => ({ isOptedOut: h.isOptedOut }));
vi.mock("@/lib/interaction", () => ({
    onlyInteractedEnabled: h.onlyInteractedEnabled,
    hasInteracted: h.hasInteracted,
    NO_INTERACTION_ERROR: "Sem conversa anterior (modo: só quem já interagiu)",
}));
vi.mock("@/lib/retention", () => ({ startRetention: vi.fn() }));
vi.mock("@/modules/agente-salao/followup", () => ({ startFollowUps: vi.fn() }));
vi.mock("@/modules/social/scheduler", () => ({ startSocialScheduler: vi.fn() }));
vi.mock("@/lib/media", () => ({ resolveMedia: h.resolveMedia }));
vi.mock("@/lib/personalize", () => ({ personalizeFor: vi.fn(async (_s: string, _to: string, text: string) => text) }));
vi.mock("@/lib/wa-jid", () => ({ resolveSendJid: vi.fn(async (_sock: unknown, jid: string) => jid) }));
vi.mock("@/lib/safe-mode", () => ({
    getSafeMode: h.getSafeMode,
    safeGate: h.safeGate,
    humanDelayMs: () => 0,
    batchPauseMs: () => 0,
}));

import { initScheduler } from "./cron";

const JID = "5561999531848@s.whatsapp.net";

function msg(over: Record<string, unknown> = {}) {
    return {
        id: "m1",
        jid: JID,
        content: "Olá!",
        mediaUrl: null,
        mediaType: null,
        cronExpression: null,
        session: { sessionId: "sessao-1", userId: "u1" },
        ...over,
    };
}

async function runTick() {
    const p = h.state.tick!();
    await vi.runAllTimersAsync();
    await p;
}

beforeEach(() => {
    vi.useFakeTimers();
    h.state.tick = null;
    h.schedule.mockClear();
    h.prisma.broadcastLog.updateMany.mockReset().mockResolvedValue({ count: 0 });
    h.prisma.scheduledMessage.findMany.mockReset();
    h.prisma.scheduledMessage.update.mockReset().mockResolvedValue({});
    h.socket.sendMessage.mockReset().mockResolvedValue({});
    h.getInstance.mockReset().mockReturnValue({ socket: h.socket });
    h.assertCanSend.mockReset().mockResolvedValue(undefined);
    h.recordMessages.mockReset().mockResolvedValue(undefined);
    h.isOptedOut.mockReset().mockResolvedValue(false);
    h.onlyInteractedEnabled.mockReset().mockResolvedValue(false);
    h.hasInteracted.mockReset().mockResolvedValue(true);
    h.getSafeMode.mockReset().mockResolvedValue(null);
    h.safeGate.mockReset().mockReturnValue({ ok: true });
    h.resolveMedia.mockReset().mockResolvedValue(Buffer.from("x"));
    initScheduler();
});

afterEach(() => vi.useRealTimers());

describe("agendador (cron.ts)", () => {
    it("agenda a rodada a cada minuto", () => {
        expect(h.schedule).toHaveBeenCalledWith("* * * * *", expect.any(Function));
    });

    it("envia texto, registra o consumo e marca SENT", async () => {
        h.prisma.scheduledMessage.findMany.mockResolvedValue([msg()]);
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledWith(JID, { text: "Olá!" });
        expect(h.recordMessages).toHaveBeenCalledWith("u1", 1);
        expect(h.prisma.scheduledMessage.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { status: "SENT" } });
    });

    it("sessão desconectada: não envia e mantém PENDING", async () => {
        h.getInstance.mockReturnValue(null);
        h.prisma.scheduledMessage.findMany.mockResolvedValue([msg()]);
        await runTick();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(h.prisma.scheduledMessage.update).not.toHaveBeenCalled();
    });

    it("descadastrado (respondeu SAIR): não envia e marca FAILED", async () => {
        h.isOptedOut.mockResolvedValue(true);
        h.prisma.scheduledMessage.findMany.mockResolvedValue([msg()]);
        await runTick();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(h.recordMessages).not.toHaveBeenCalled();
        expect(h.prisma.scheduledMessage.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { status: "FAILED" } });
    });

    it("modo 'só quem já interagiu': quem nunca falou fica sem envio (FAILED)", async () => {
        h.onlyInteractedEnabled.mockResolvedValue(true);
        h.hasInteracted.mockResolvedValue(false);
        h.prisma.scheduledMessage.findMany.mockResolvedValue([msg()]);
        await runTick();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(h.prisma.scheduledMessage.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { status: "FAILED" } });
    });

    it("plano bloqueia: mensagem única vira FAILED sem enviar", async () => {
        h.assertCanSend.mockRejectedValue(new Error("Assinatura suspensa"));
        h.prisma.scheduledMessage.findMany.mockResolvedValue([msg()]);
        await runTick();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(h.prisma.scheduledMessage.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { status: "FAILED" } });
    });

    it("plano bloqueia: mensagem recorrente só adia o próximo envio", async () => {
        h.assertCanSend.mockRejectedValue(new Error("Sem cota"));
        h.prisma.scheduledMessage.findMany.mockResolvedValue([msg({ cronExpression: "0 9 * * 1" })]);
        await runTick();
        const call = h.prisma.scheduledMessage.update.mock.calls[0][0];
        expect(call.data.status).toBeUndefined();
        expect(call.data.sendAt).toBeInstanceOf(Date);
    });

    it("fora da janela do Modo Seguro: espera, sem enviar nem alterar", async () => {
        h.getSafeMode.mockResolvedValue({ delayMinSec: 10, delayMaxSec: 40, batchSize: 25, batchPauseMin: 3, startHour: 9, endHour: 19 });
        h.safeGate.mockReturnValue({ ok: false, resumeAt: new Date() });
        h.prisma.scheduledMessage.findMany.mockResolvedValue([msg()]);
        await runTick();
        expect(h.socket.sendMessage).not.toHaveBeenCalled();
        expect(h.prisma.scheduledMessage.update).not.toHaveBeenCalled();
    });

    it("recorrente enviada: reprograma sem marcar SENT", async () => {
        h.prisma.scheduledMessage.findMany.mockResolvedValue([msg({ cronExpression: "0 9 * * 1" })]);
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledTimes(1);
        const call = h.prisma.scheduledMessage.update.mock.calls[0][0];
        expect(call.data.status).toBeUndefined();
        expect(call.data.sendAt).toBeInstanceOf(Date);
    });

    it("mídia de imagem vai com a legenda personalizada", async () => {
        h.prisma.scheduledMessage.findMany.mockResolvedValue([msg({ mediaUrl: "/media/foto.jpg", mediaType: "image" })]);
        await runTick();
        expect(h.socket.sendMessage).toHaveBeenCalledWith(JID, { caption: "Olá!", image: Buffer.from("x") });
    });

    it("falha do socket: mensagem única vira FAILED e a rodada continua", async () => {
        h.socket.sendMessage.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({});
        h.prisma.scheduledMessage.findMany.mockResolvedValue([msg({ id: "a" }), msg({ id: "b" })]);
        await runTick();
        expect(h.prisma.scheduledMessage.update).toHaveBeenCalledWith({ where: { id: "a" }, data: { status: "FAILED" } });
        expect(h.prisma.scheduledMessage.update).toHaveBeenCalledWith({ where: { id: "b" }, data: { status: "SENT" } });
    });

    it("sem mensagens pendentes: não faz nada", async () => {
        h.prisma.scheduledMessage.findMany.mockResolvedValue([]);
        await runTick();
        expect(h.getInstance).not.toHaveBeenCalled();
    });
});
