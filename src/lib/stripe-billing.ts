import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { sendMail, welcomeMail } from "@/lib/mailer";
import type { PlanKey } from "@/lib/plans";

/**
 * Integração com a Stripe sem SDK nem chave secreta: o servidor só recebe webhooks
 * assinados (STRIPE_WEBHOOK_SECRET) e reconhece os planos pela "lookup key" dos preços.
 */

const LOOKUP_TO_PLAN: Record<string, PlanKey> = {
    saiae_essencial: "ESSENCIAL",
    saiae_pro: "PRO",
    saiae_escala: "ESCALA",
};
const EXTRA_LOOKUP = "saiae_numero_extra";
const PLAN_PRIORITY: PlanKey[] = ["ESCALA", "PRO", "ESSENCIAL"];
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Confere a assinatura do webhook (cabeçalho Stripe-Signature). */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, toleranceSec = 300): boolean {
    if (!header) return false;
    const parts = header.split(",").map((p) => p.trim().split("="));
    const t = parts.find(([k]) => k === "t")?.[1];
    const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
    if (!t || signatures.length === 0) return false;
    if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;

    const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
    return signatures.some((sig) => {
        const a = Buffer.from(sig, "hex");
        const b = Buffer.from(expected, "hex");
        return a.length === b.length && timingSafeEqual(a, b);
    });
}

/** Recalcula o plano do usuário a partir de todas as assinaturas dele. */
export async function recomputeUserPlan(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || user.role === "SUPERADMIN") return;

    const subs = await prisma.stripeSubscription.findMany({ where: { userId } });
    if (subs.length === 0) return;

    const active = subs.filter((s) => ACTIVE_STATUSES.has(s.status));
    const plans = active.map((s) => s.planKey as PlanKey | null).filter((p): p is PlanKey => !!p);
    const best = PLAN_PRIORITY.find((p) => plans.includes(p));
    const extras = active.reduce((sum, s) => sum + (s.extraQuantity || 0), 0);

    const everHadPlan = subs.some((s) => !!s.planKey);

    if (best) {
        await prisma.user.update({
            where: { id: userId },
            data: { plan: best, planStatus: "ACTIVE", trialEndsAt: null, extraSessions: extras },
        });
    } else if (everHadPlan) {
        // a assinatura do plano terminou: bloqueia os envios, mantém os dados
        await prisma.user.update({ where: { id: userId }, data: { planStatus: "SUSPENDED", extraSessions: 0 } });
    } else {
        // só comprou número extra (plano gerenciado manualmente): mexe apenas nos extras
        await prisma.user.update({ where: { id: userId }, data: { extraSessions: extras } });
    }
}

/** Aplica um evento customer.subscription.* em uma assinatura já vinculada a um usuário. */
async function applySubscriptionObject(obj: any): Promise<boolean> {
    const existing = await prisma.stripeSubscription.findUnique({ where: { id: obj.id } });
    if (!existing) return false;

    const items: any[] = obj.items?.data || [];
    let planKey: string | null = null;
    let extraQuantity = 0;
    for (const it of items) {
        const key = it?.price?.lookup_key as string | undefined;
        if (!key) continue;
        if (LOOKUP_TO_PLAN[key]) planKey = LOOKUP_TO_PLAN[key];
        else if (key === EXTRA_LOOKUP) extraQuantity += Number(it.quantity) || 1;
    }

    await prisma.stripeSubscription.update({
        where: { id: obj.id },
        data: { status: String(obj.status || "incomplete"), planKey, extraQuantity, customerId: String(obj.customer || existing.customerId) },
    });
    await recomputeUserPlan(existing.userId);
    return true;
}

async function createAccountForBuyer(email: string, name: string | null): Promise<string> {
    const randomPassword = randomBytes(24).toString("hex");
    const user = await prisma.user.create({
        data: {
            email,
            name: name || null,
            password: await bcrypt.hash(randomPassword, 10),
            role: "OWNER",
            plan: "ESSENCIAL",
        },
    });

    // e-mail de boas-vindas com o link para criar a senha (mesmo mecanismo da redefinição)
    const token = randomBytes(32).toString("hex");
    await prisma.passwordReset.create({
        data: {
            userId: user.id,
            tokenHash: createHash("sha256").update(token).digest("hex"),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 dias
        },
    });
    const base = (process.env.BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
    await sendMail({ to: email, ...welcomeMail(`${base}/auth/reset-password?token=${token}`) });
    return user.id;
}

async function handleCheckoutCompleted(session: any): Promise<void> {
    if (session.mode !== "subscription" || !session.subscription) return;

    const email = String(session.customer_details?.email || session.customer_email || "").trim().toLowerCase();
    let userId: string | null = null;

    const ref = session.client_reference_id as string | undefined;
    if (ref) {
        const byRef = await prisma.user.findUnique({ where: { id: ref }, select: { id: true } });
        if (byRef) userId = byRef.id;
    }
    if (!userId && email) {
        const byEmail = await prisma.user.findUnique({ where: { email }, select: { id: true } });
        if (byEmail) userId = byEmail.id;
    }
    if (!userId) {
        if (!email) {
            console.error("[stripe] checkout sem e-mail e sem usuário conhecido:", session.id);
            return;
        }
        userId = await createAccountForBuyer(email, session.customer_details?.name ?? null);
    }

    await prisma.stripeSubscription.upsert({
        where: { id: String(session.subscription) },
        create: { id: String(session.subscription), userId, customerId: String(session.customer || "") },
        update: { userId },
    });
    await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: String(session.customer || "") || undefined, stripeSubscriptionId: String(session.subscription) },
    });

    // reaplica eventos da assinatura que chegaram antes do checkout
    const pending = await prisma.stripeEvent.findMany({
        where: { objectId: String(session.subscription), processedAt: null, type: { startsWith: "customer.subscription." } },
        orderBy: { createdAt: "asc" },
    });
    for (const ev of pending) {
        const obj = (ev.payload as any)?.data?.object;
        if (obj && (await applySubscriptionObject(obj))) {
            await prisma.stripeEvent.update({ where: { id: ev.id }, data: { processedAt: new Date() } });
        }
    }
}

/** Processa um evento já validado. Idempotente: o mesmo evento nunca é aplicado duas vezes. */
export async function handleStripeEvent(event: any): Promise<void> {
    const obj = event?.data?.object;
    const already = await prisma.stripeEvent.findUnique({ where: { id: event.id }, select: { processedAt: true } });
    if (already?.processedAt) return;

    if (!already) {
        await prisma.stripeEvent.create({
            data: { id: event.id, type: event.type, objectId: obj?.id ? String(obj.id) : null, payload: event },
        });
    }

    let processed = true;
    switch (event.type) {
        case "checkout.session.completed":
            await handleCheckoutCompleted(obj);
            break;
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
            // se ainda não sabemos de quem é, fica pendente até o checkout chegar
            processed = await applySubscriptionObject(event.type === "customer.subscription.deleted" ? { ...obj, status: "canceled" } : obj);
            break;
        case "invoice.paid":
        case "invoice.payment_failed":
            // o estado da assinatura chega pelos eventos customer.subscription.*; aqui só registramos
            if (event.type === "invoice.payment_failed") console.warn("[stripe] pagamento falhou:", obj?.customer, obj?.subscription);
            break;
        default:
            break;
    }

    if (processed) {
        await prisma.stripeEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    }
}
