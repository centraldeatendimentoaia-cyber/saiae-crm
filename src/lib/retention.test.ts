import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    prisma: {
        message: { groupBy: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
        contact: { updateMany: vi.fn() },
        mensagemOrigem: { deleteMany: vi.fn() },
        webhookLog: { deleteMany: vi.fn() },
        scheduledMessageAttempt: { deleteMany: vi.fn() },
    },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));
vi.mock("@/lib/job-lock", () => ({ withJobLock: vi.fn() }));
vi.mock("@/lib/media-retention", () => ({ limparMidiasAntigas: vi.fn(async () => 0) }));
vi.mock("@/modules/ia-atendimento/store", () => ({ limparMensagensAntigas: vi.fn(async () => 0) }));
vi.mock("@/modules/ia-atendimento/vendas/lead-store", () => ({ limparLeadsAntigos: vi.fn(async () => 0) }));

import { runRetention } from "./retention";

beforeEach(() => {
    vi.clearAllMocks();
    h.prisma.message.groupBy.mockResolvedValue([]);
    h.prisma.message.findMany.mockResolvedValue([]);
    h.prisma.mensagemOrigem.deleteMany.mockResolvedValue({ count: 0 });
    h.prisma.webhookLog.deleteMany.mockResolvedValue({ count: 0 });
    h.prisma.scheduledMessageAttempt.deleteMany.mockResolvedValue({ count: 2 });
});

describe("retenção das tentativas do agendador", () => {
    it("apaga tentativas finalizadas com mais de 90 dias (nunca as 'claimed') e uma falha não derruba o resto", async () => {
        await runRetention();
        const where = h.prisma.scheduledMessageAttempt.deleteMany.mock.calls[0][0].where;
        expect(where.status).toEqual({ not: "claimed" });
        const idadeDias = (Date.now() - where.claimedAt.lt.getTime()) / 86_400_000;
        expect(Math.round(idadeDias)).toBe(90);

        h.prisma.scheduledMessageAttempt.deleteMany.mockRejectedValue(new Error("tabela ausente"));
        await runRetention();
        expect(h.prisma.webhookLog.deleteMany).toHaveBeenCalledTimes(2); // a limpeza seguinte continua
    });
});
