import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function withParams(base: string | undefined, userId: string, email: string): string | null {
    if (!base) return null;
    try {
        const u = new URL(base);
        u.searchParams.set("prefilled_email", email);
        u.searchParams.set("client_reference_id", userId);
        return u.toString();
    } catch {
        return null;
    }
}

/** Links de assinatura (Stripe) já preenchidos com o e-mail e o ID da conta logada. */
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });

    const full = await prisma.user.findUnique({
        where: { id: user.id },
        select: { email: true, stripeCustomerId: true, _count: { select: { stripeSubscriptions: true } } },
    });
    if (!full) return NextResponse.json({ status: false, error: "Not found" }, { status: 404 });

    return NextResponse.json({
        status: true,
        data: {
            links: {
                ESSENCIAL: withParams(process.env.STRIPE_LINK_ESSENCIAL, user.id, full.email),
                PRO: withParams(process.env.STRIPE_LINK_PRO, user.id, full.email),
                ESCALA: withParams(process.env.STRIPE_LINK_ESCALA, user.id, full.email),
                EXTRA: withParams(process.env.STRIPE_LINK_EXTRA, user.id, full.email),
            },
            portalUrl: full._count.stripeSubscriptions > 0 ? process.env.STRIPE_PORTAL_URL || null : null,
        },
    });
}
