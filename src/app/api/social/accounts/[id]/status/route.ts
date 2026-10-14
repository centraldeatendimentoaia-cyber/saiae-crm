import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { decryptToken } from "@/modules/social/crypto";
import { checkToken } from "@/modules/social/graph";

/** GET /api/social/accounts/:id/status — pergunta à Meta se o token ainda vale. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const acc = await prisma.socialAccount.findFirst({ where: { id, userId: user.id }, select: { accessToken: true, externalId: true } });
    if (!acc) return NextResponse.json({ status: false, message: "Not found" }, { status: 404 });

    try {
        const result = await checkToken(acc.externalId, decryptToken(acc.accessToken));
        return NextResponse.json({ status: true, data: result });
    } catch (e) {
        return NextResponse.json({ status: false, message: e instanceof Error ? e.message : "Falha ao consultar a Meta." }, { status: 500 });
    }
}
