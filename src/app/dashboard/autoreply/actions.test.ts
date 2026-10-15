import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    prisma: {
        session: { findUnique: vi.fn() },
        autoReply: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    },
    acesso: true,
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/api-auth", () => ({ canAccessSession: async () => h.acesso }));
vi.mock("@/lib/server-action-auth", () => ({ getAuthenticatedUserForAction: async () => ({ id: "u1", role: "OWNER" }) }));

import { createAutoReply, updateAutoReply, deleteAutoReply } from "./actions";

const dados = { keyword: "oi", response: "olá", matchType: "EXACT", isMedia: false, triggerType: "ALL" };

beforeEach(() => { vi.clearAllMocks(); h.acesso = true; h.prisma.session.findUnique.mockResolvedValue({ id: "c1" }); });

describe("server actions de autorresposta", () => {
    it("rejeita matchType e triggerType desconhecidos antes de gravar", async () => {
        await expect(createAutoReply("s1", { ...dados, matchType: "PARECIDO" })).rejects.toThrow(/matchType/);
        await expect(updateAutoReply("s1", "r1", { ...dados, triggerType: "X" })).rejects.toThrow(/triggerType/);
        expect(h.prisma.autoReply.create).not.toHaveBeenCalled();
    });
    it("cria com valores válidos", async () => {
        h.prisma.autoReply.create.mockResolvedValue({ id: "r1" });
        await createAutoReply("s1", dados);
        expect(h.prisma.autoReply.create).toHaveBeenCalled();
    });
    it("sem acesso à sessão: Forbidden", async () => {
        h.acesso = false;
        await expect(createAutoReply("s1", dados)).rejects.toThrow("Forbidden");
    });
    it("regra de outra sessão: Forbidden em editar e apagar", async () => {
        h.prisma.autoReply.findUnique.mockResolvedValue({ id: "r1", session: { sessionId: "outra" } });
        await expect(updateAutoReply("s1", "r1", dados)).rejects.toThrow("Forbidden");
        await expect(deleteAutoReply("s1", "r1")).rejects.toThrow("Forbidden");
        expect(h.prisma.autoReply.update).not.toHaveBeenCalled();
        expect(h.prisma.autoReply.delete).not.toHaveBeenCalled();
    });
});
