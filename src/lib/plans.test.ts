import { describe, it, expect, vi, beforeEach } from "vitest";

const { prisma } = vi.hoisted(() => ({
    prisma: {
        user: { findUnique: vi.fn() },
        session: { count: vi.fn(), findUnique: vi.fn() },
        usageCounter: { findUnique: vi.fn(), upsert: vi.fn() },
    },
}));
vi.mock("@/lib/prisma", () => ({ prisma }));

import { PLANS, PlanError, getEntitlement, assertCanSend, assertCanUseAI, assertCanCreateSession, recordMessages, recordAI, ownerIdOfSession } from "./plans";

const period = new Date().toISOString().slice(0, 7);

function setup(user: Partial<Record<string, unknown>>, usage: { messages?: number; aiGenerations?: number } | null = null, sessions = 0) {
    prisma.user.findUnique.mockResolvedValue({ role: "OWNER", plan: "ESSENCIAL", planStatus: "ACTIVE", trialEndsAt: null, extraSessions: 0, ...user });
    prisma.session.count.mockResolvedValue(sessions);
    prisma.usageCounter.findUnique.mockResolvedValue(usage);
}

beforeEach(() => {
    Object.values(prisma).forEach((m) => Object.values(m).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset()));
});

describe("PLANS", () => {
    it("mantém os limites publicados", () => {
        expect(PLANS.ESSENCIAL).toMatchObject({ priceBRL: 49, sessions: 1, messages: 1000, ai: 50 });
        expect(PLANS.PRO).toMatchObject({ priceBRL: 99, sessions: 2, messages: 5000, ai: 300 });
        expect(PLANS.ESCALA).toMatchObject({ priceBRL: 199, sessions: 5, messages: 20000, ai: 1000 });
        expect(PLANS.ILIMITADO.messages).toBeNull();
    });
});

describe("getEntitlement", () => {
    it("usuário inexistente lança PlanError", async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        await expect(getEntitlement("x")).rejects.toBeInstanceOf(PlanError);
    });
    it("SUPERADMIN é sempre ilimitado, mesmo suspenso", async () => {
        setup({ role: "SUPERADMIN", plan: "ESSENCIAL", planStatus: "SUSPENDED" });
        const e = await getEntitlement("u");
        expect(e.plan.key).toBe("ILIMITADO");
        expect(e.blockedReason).toBeNull();
    });
    it("plano desconhecido cai em ILIMITADO (comportamento atual, registrado para não mudar sem querer)", async () => {
        setup({ plan: "INEXISTENTE" });
        expect((await getEntitlement("u")).plan.key).toBe("ILIMITADO");
    });
    it("soma números extras ao limite de sessões", async () => {
        setup({ plan: "PRO", extraSessions: 3 });
        expect((await getEntitlement("u")).limits.sessions).toBe(5);
    });
    it("assinatura suspensa bloqueia", async () => {
        setup({ planStatus: "SUSPENDED" });
        const e = await getEntitlement("u");
        expect(e.status).toBe("SUSPENDED");
        expect(e.blockedReason).toMatch(/suspensa/);
    });
    it("teste grátis vencido bloqueia, em vigor não", async () => {
        setup({ plan: "TRIAL", trialEndsAt: new Date(Date.now() - 1000) });
        expect((await getEntitlement("u")).blockedReason).toMatch(/teste terminou/);
        setup({ plan: "TRIAL", trialEndsAt: new Date(Date.now() + 86_400_000) });
        expect((await getEntitlement("u")).blockedReason).toBeNull();
    });
    it("lê o uso do mês corrente", async () => {
        setup({}, { messages: 7, aiGenerations: 2 }, 1);
        const e = await getEntitlement("u");
        expect(e.usage).toEqual({ sessions: 1, messages: 7, ai: 2 });
        expect(e.period).toBe(period);
    });
});

describe("assertCanSend", () => {
    it("permite dentro da cota", async () => {
        setup({}, { messages: 10 });
        await expect(assertCanSend("u", 5)).resolves.toBeUndefined();
    });
    it("permite exatamente até o limite", async () => {
        setup({}, { messages: 999 });
        await expect(assertCanSend("u", 1)).resolves.toBeUndefined();
    });
    it("bloqueia ao passar do limite e informa o que sobra", async () => {
        setup({}, { messages: 995 });
        await expect(assertCanSend("u", 10)).rejects.toThrow(/mais 5 envio/);
    });
    it("bloqueia quando a cota acabou", async () => {
        setup({}, { messages: 1000 });
        await expect(assertCanSend("u", 1)).rejects.toThrow(/todos os 1000 envios/);
    });
    it("PlanError carrega status 402", async () => {
        setup({ planStatus: "SUSPENDED" });
        await expect(assertCanSend("u", 1)).rejects.toMatchObject({ status: 402, name: "PlanError" });
    });
    it("plano ilimitado nunca bloqueia por cota", async () => {
        setup({ plan: "ILIMITADO" }, { messages: 10_000_000 });
        await expect(assertCanSend("u", 1000)).resolves.toBeUndefined();
    });
});

describe("assertCanUseAI", () => {
    it("bloqueia ao atingir a cota mensal de IA", async () => {
        setup({}, { aiGenerations: 50 });
        await expect(assertCanUseAI("u")).rejects.toThrow(/50 gerações/);
    });
    it("permite abaixo da cota", async () => {
        setup({}, { aiGenerations: 49 });
        await expect(assertCanUseAI("u")).resolves.toBeUndefined();
    });
});

describe("assertCanCreateSession", () => {
    it("bloqueia quando já tem o máximo de números", async () => {
        setup({}, null, 1);
        await expect(assertCanCreateSession("u")).rejects.toThrow(/1 número/);
    });
    it("número extra libera mais uma sessão", async () => {
        setup({ extraSessions: 1 }, null, 1);
        await expect(assertCanCreateSession("u")).resolves.toBeUndefined();
    });
});

describe("contadores", () => {
    it("recordMessages incrementa no período corrente", async () => {
        await recordMessages("u", 3);
        expect(prisma.usageCounter.upsert).toHaveBeenCalledWith({
            where: { userId_period: { userId: "u", period } },
            create: { userId: "u", period, messages: 3 },
            update: { messages: { increment: 3 } },
        });
    });
    it("recordAI incrementa uma geração", async () => {
        await recordAI("u");
        expect(prisma.usageCounter.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ update: { aiGenerations: { increment: 1 } } })
        );
    });
    it("ownerIdOfSession devolve o dono ou null", async () => {
        prisma.session.findUnique.mockResolvedValueOnce({ userId: "dono" });
        expect(await ownerIdOfSession("s")).toBe("dono");
        prisma.session.findUnique.mockResolvedValueOnce(null);
        expect(await ownerIdOfSession("s")).toBeNull();
    });
});
