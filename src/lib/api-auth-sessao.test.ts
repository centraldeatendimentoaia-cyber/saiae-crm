import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    sessions: [] as { id: string; userId: string; sessionId: string }[],
    acessos: [] as { sessionId: string; userId: string }[],
}));
vi.mock("./prisma", () => ({
    prisma: {
        session: {
            findFirst: vi.fn(async ({ where }: { where: { id?: string; sessionId?: string } }) =>
                h.sessions.find((s) => (where.id !== undefined ? s.id === where.id : s.sessionId === where.sessionId)) ?? null),
        },
        sessionAccess: {
            findUnique: vi.fn(async ({ where }: { where: { sessionId_userId: { sessionId: string; userId: string } } }) =>
                h.acessos.find((a) => a.sessionId === where.sessionId_userId.sessionId && a.userId === where.sessionId_userId.userId) ?? null),
        },
    },
}));
vi.mock("./auth", () => ({ auth: vi.fn() }));
vi.mock("./logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { canAccessSession } from "./api-auth";

beforeEach(() => {
    h.sessions = [
        { id: "cuid-a", userId: "ua", sessionId: "loja-a" },
        { id: "cuid-b", userId: "ub", sessionId: "cuid-a" }, // B escolheu como NOME o id interno da sessão de A
    ];
    h.acessos = [];
});

describe("canAccessSession", () => {
    it("dono acessa a própria sessão pelo id interno e pelo nome", async () => {
        expect(await canAccessSession("ua", "OWNER", "cuid-a")).toBe(true);
        expect(await canAccessSession("ua", "OWNER", "loja-a")).toBe(true);
    });
    it("outro usuário não acessa a sessão alheia", async () => {
        expect(await canAccessSession("ub", "OWNER", "loja-a")).toBe(false);
    });
    it("nome escolhido igual ao id interno de outra sessão não dá acesso à sessão de A (o id vence o nome)", async () => {
        expect(await canAccessSession("ub", "OWNER", "cuid-a")).toBe(false);
        expect(await canAccessSession("ua", "OWNER", "cuid-a")).toBe(true);
    });
    it("acesso compartilhado vale; sessão inexistente nega; SUPERADMIN acessa tudo", async () => {
        h.acessos = [{ sessionId: "cuid-a", userId: "uc" }];
        expect(await canAccessSession("uc", "OWNER", "loja-a")).toBe(true);
        expect(await canAccessSession("uc", "OWNER", "nao-existe")).toBe(false);
        expect(await canAccessSession("ux", "SUPERADMIN", "qualquer")).toBe(true);
    });
});
