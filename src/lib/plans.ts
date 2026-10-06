import { prisma } from "@/lib/prisma";

/**
 * Planos e limites. Os valores (null = ilimitado) podem ser ajustados aqui sem mexer no resto do app.
 * Conta de cobrança = dono da sessão (quem criou o número). Usuários que só recebem acesso
 * a uma sessão consomem a cota do dono.
 */
export type PlanKey = "TRIAL" | "ESSENCIAL" | "PRO" | "ESCALA" | "ILIMITADO";

export interface PlanDef {
    key: PlanKey;
    name: string;
    priceBRL: number | null;
    sessions: number | null; // números de WhatsApp
    messages: number | null; // disparos por mês (disparo em massa + agendados)
    ai: number | null; // gerações de texto com IA por mês
}

export const PLANS: Record<PlanKey, PlanDef> = {
    TRIAL: { key: "TRIAL", name: "Teste grátis", priceBRL: 0, sessions: 1, messages: 50, ai: 10 },
    ESSENCIAL: { key: "ESSENCIAL", name: "Essencial", priceBRL: 49, sessions: 1, messages: 1000, ai: 50 },
    PRO: { key: "PRO", name: "Pro", priceBRL: 99, sessions: 2, messages: 5000, ai: 300 },
    ESCALA: { key: "ESCALA", name: "Escala", priceBRL: 199, sessions: 5, messages: 20000, ai: 1000 },
    ILIMITADO: { key: "ILIMITADO", name: "Ilimitado", priceBRL: null, sessions: null, messages: null, ai: null },
};

export const TRIAL_DAYS = 3;

export class PlanError extends Error {
    status = 402;
    constructor(message: string) {
        super(message);
        this.name = "PlanError";
    }
}

const currentPeriod = () => new Date().toISOString().slice(0, 7); // AAAA-MM

export interface Entitlement {
    plan: PlanDef;
    status: "ACTIVE" | "SUSPENDED";
    blockedReason: string | null;
    trialEndsAt: Date | null;
    limits: { sessions: number | null; messages: number | null; ai: number | null };
    usage: { sessions: number; messages: number; ai: number };
    period: string;
}

export async function getEntitlement(userId: string): Promise<Entitlement> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, plan: true, planStatus: true, trialEndsAt: true, extraSessions: true },
    });
    if (!user) throw new PlanError("Usuário não encontrado.");

    const key: PlanKey = user.role === "SUPERADMIN" ? "ILIMITADO" : ((user.plan in PLANS ? user.plan : "ILIMITADO") as PlanKey);
    const plan = PLANS[key];
    const period = currentPeriod();

    const [sessions, counter] = await Promise.all([
        prisma.session.count({ where: { userId } }),
        prisma.usageCounter.findUnique({ where: { userId_period: { userId, period } } }),
    ]);

    let blockedReason: string | null = null;
    if (user.role !== "SUPERADMIN") {
        if (user.planStatus === "SUSPENDED") {
            blockedReason = "Sua assinatura está suspensa. Regularize o pagamento para voltar a enviar mensagens.";
        } else if (key === "TRIAL" && user.trialEndsAt && user.trialEndsAt < new Date()) {
            blockedReason = "Seu período de teste terminou. Escolha um plano para continuar enviando.";
        }
    }

    return {
        plan,
        status: user.planStatus === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
        blockedReason,
        trialEndsAt: user.trialEndsAt,
        limits: {
            sessions: plan.sessions === null ? null : plan.sessions + (user.extraSessions || 0),
            messages: plan.messages,
            ai: plan.ai,
        },
        usage: { sessions, messages: counter?.messages ?? 0, ai: counter?.aiGenerations ?? 0 },
        period,
    };
}

/** Quem paga pela sessão: o dono dela. */
export async function ownerIdOfSession(sessionKey: string): Promise<string | null> {
    const s = await prisma.session.findUnique({ where: { sessionId: sessionKey }, select: { userId: true } });
    return s?.userId ?? null;
}

export async function assertCanSend(userId: string, count: number): Promise<void> {
    const e = await getEntitlement(userId);
    if (e.blockedReason) throw new PlanError(e.blockedReason);
    const max = e.limits.messages;
    if (max !== null && e.usage.messages + count > max) {
        const remaining = Math.max(0, max - e.usage.messages);
        throw new PlanError(
            remaining === 0
                ? `Você usou todos os ${max} envios do plano ${e.plan.name} neste mês.`
                : `Seu plano ${e.plan.name} permite mais ${remaining} envio(s) neste mês (limite de ${max}). Reduza a lista ou mude de plano.`
        );
    }
}

export async function recordMessages(userId: string, count = 1): Promise<void> {
    const period = currentPeriod();
    await prisma.usageCounter.upsert({
        where: { userId_period: { userId, period } },
        create: { userId, period, messages: count },
        update: { messages: { increment: count } },
    });
}

export async function assertCanUseAI(userId: string): Promise<void> {
    const e = await getEntitlement(userId);
    if (e.blockedReason) throw new PlanError(e.blockedReason);
    if (e.limits.ai !== null && e.usage.ai >= e.limits.ai) {
        throw new PlanError(`Você usou as ${e.limits.ai} gerações de texto com IA do plano ${e.plan.name} neste mês.`);
    }
}

export async function recordAI(userId: string): Promise<void> {
    const period = currentPeriod();
    await prisma.usageCounter.upsert({
        where: { userId_period: { userId, period } },
        create: { userId, period, aiGenerations: 1 },
        update: { aiGenerations: { increment: 1 } },
    });
}

export async function assertCanCreateSession(userId: string): Promise<void> {
    const e = await getEntitlement(userId);
    if (e.blockedReason) throw new PlanError(e.blockedReason);
    const max = e.limits.sessions;
    if (max !== null && e.usage.sessions >= max) {
        throw new PlanError(`Seu plano ${e.plan.name} permite ${max} número(s) de WhatsApp. Para conectar outro, faça upgrade ou adicione um número extra.`);
    }
}
