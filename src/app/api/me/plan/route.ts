import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { getEntitlement } from "@/lib/plans";

/** Plano, limites e consumo do mês da conta logada. */
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }
    try {
        const e = await getEntitlement(user.id);
        return NextResponse.json({
            status: true,
            data: {
                plan: { key: e.plan.key, name: e.plan.name, priceBRL: e.plan.priceBRL },
                status: e.status,
                blockedReason: e.blockedReason,
                trialEndsAt: e.trialEndsAt,
                limits: e.limits,
                usage: e.usage,
                period: e.period,
            },
        });
    } catch (error) {
        console.error("Plan error", error);
        return NextResponse.json({ status: false, error: "Internal Server Error" }, { status: 500 });
    }
}
