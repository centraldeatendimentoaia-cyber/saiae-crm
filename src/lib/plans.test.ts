import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    // Os testes abaixo cobrem o comportamento de planos, que só vale com a cobrança ligada.
    vi.stubEnv("BILLING_ENFORCEMENT", "on");
    vi.stubEnv("AI_MONTHLY_CAP", "");
});
afterEach(() => vi.unstubAllEnvs());

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

describe("interruptor BILLING_ENFORCEMENT", () => {
    const off = (value?: string) => {
        if (value === undefined) vi.stubEnv("BILLING_ENFORCEMENT", "");
        else vi.stubEnv("BILLING_ENFORCEMENT", value);
    };

    describe("desligado (padrão)", () => {
        it.each([undefined, "", "off", "OFF", "qualquer-coisa", "false", "0"])("valor %s conta como desligado", async (v) => {
            off(v);
            setup({ plan: "TRIAL", planStatus: "SUSPENDED", trialEndsAt: new Date(Date.now() - 86_400_000) });
            const e = await getEntitlement("u");
            expect(e.billingEnforced).toBe(false);
            expect(e.blockedReason).toBeNull();
            expect(e.status).toBe("ACTIVE");
        });
        it("variável ausente de verdade (sem definir) também é desligado", async () => {
            vi.unstubAllEnvs();
            delete process.env.BILLING_ENFORCEMENT;
            setup({ plan: "TRIAL" });
            expect((await getEntitlement("u")).billingEnforced).toBe(false);
        });
        it("libera: sem limite de números, disparos nem bloqueio por suspensão ou trial vencido", async () => {
            off("off");
            setup({ plan: "TRIAL", planStatus: "SUSPENDED", trialEndsAt: new Date(Date.now() - 1000) }, { messages: 10_000_000 }, 50);
            const e = await getEntitlement("u");
            expect(e.limits).toMatchObject({ sessions: null, messages: null });
            expect(e.trialEndsAt).toBeNull();
            await expect(assertCanSend("u", 100_000)).resolves.toBeUndefined();
            await expect(assertCanCreateSession("u")).resolves.toBeUndefined();
        });
        it("o uso continua sendo contado (números certos quando a cobrança voltar)", async () => {
            off("off");
            await recordMessages("u", 4);
            expect(prisma.usageCounter.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ update: { messages: { increment: 4 } } })
            );
            setup({}, { messages: 7, aiGenerations: 3 }, 2);
            expect((await getEntitlement("u")).usage).toEqual({ sessions: 2, messages: 7, ai: 3 });
        });
        it("usuário inexistente continua dando erro (não vira acesso livre)", async () => {
            off("off");
            prisma.user.findUnique.mockResolvedValue(null);
            await expect(getEntitlement("x")).rejects.toBeInstanceOf(PlanError);
        });
        it("SUPERADMIN também fica sob o teto de IA", async () => {
            off("off");
            vi.stubEnv("AI_MONTHLY_CAP", "10");
            setup({ role: "SUPERADMIN" }, { aiGenerations: 10 });
            await expect(assertCanUseAI("u")).rejects.toThrow(/limite de 10/);
        });
    });

    describe("ligado", () => {
        it.each(["on", "ON", " on ", "true", "1"])("valor %j liga a cobrança", async (v) => {
            vi.stubEnv("BILLING_ENFORCEMENT", v);
            setup({ planStatus: "SUSPENDED" });
            const e = await getEntitlement("u");
            expect(e.billingEnforced).toBe(true);
            expect(e.blockedReason).toMatch(/suspensa/);
        });
        it("volta ao comportamento de planos: cota de disparos e de sessões valem", async () => {
            setup({}, { messages: 1000 }, 1);
            await expect(assertCanSend("u", 1)).rejects.toThrow(/todos os 1000 envios/);
            await expect(assertCanCreateSession("u")).rejects.toThrow(/1 número/);
        });
        it("teste grátis vencido volta a bloquear", async () => {
            setup({ plan: "TRIAL", trialEndsAt: new Date(Date.now() - 1000) });
            await expect(assertCanSend("u", 1)).rejects.toThrow(/teste terminou/);
        });
        it("AI_MONTHLY_CAP não altera o limite do plano quando a cobrança está ligada", async () => {
            vi.stubEnv("AI_MONTHLY_CAP", "5");
            setup({}, { aiGenerations: 10 }); // ESSENCIAL = 50
            await expect(assertCanUseAI("u")).resolves.toBeUndefined();
        });
    });

    describe("teto de IA vale nos dois modos", () => {
        it("desligado: usa AI_MONTHLY_CAP (padrão 200)", async () => {
            off("off");
            setup({}, { aiGenerations: 199 });
            await expect(assertCanUseAI("u")).resolves.toBeUndefined();
            setup({}, { aiGenerations: 200 });
            await expect(assertCanUseAI("u")).rejects.toThrow(/limite de 200/);
            expect((await getEntitlement("u")).limits.ai).toBe(200);
        });
        it("desligado: o teto é configurável por AI_MONTHLY_CAP", async () => {
            off("off");
            vi.stubEnv("AI_MONTHLY_CAP", "25");
            setup({}, { aiGenerations: 25 });
            await expect(assertCanUseAI("u")).rejects.toThrow(/limite de 25/);
        });
        it.each(["abc", "0", "-5", ""])("AI_MONTHLY_CAP inválido (%j) cai no padrão de 200, nunca em ilimitado", async (v) => {
            off("off");
            vi.stubEnv("AI_MONTHLY_CAP", v);
            setup({});
            expect((await getEntitlement("u")).limits.ai).toBe(200);
        });
        it("ligado: vale o limite do plano (ESSENCIAL = 50)", async () => {
            setup({}, { aiGenerations: 50 });
            await expect(assertCanUseAI("u")).rejects.toThrow(/50 gerações/);
        });
        it("a contagem de IA segue sendo gravada nos dois modos", async () => {
            off("off");
            await recordAI("u");
            vi.stubEnv("BILLING_ENFORCEMENT", "on");
            await recordAI("u");
            expect(prisma.usageCounter.upsert).toHaveBeenCalledTimes(2);
        });
    });
});
