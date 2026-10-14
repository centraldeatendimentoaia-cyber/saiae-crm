import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";

/** DELETE /api/social/accounts/:id — desconecta a conta e cancela as postagens pendentes dela. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const acc = await prisma.socialAccount.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!acc) return NextResponse.json({ status: false, message: "Not found" }, { status: 404 });
    await prisma.scheduledPost.updateMany({ where: { accountId: id, status: "PENDING" }, data: { status: "FAILED", error: "Conta desconectada antes da publicação." } });
    await prisma.socialAccount.delete({ where: { id } });
    return NextResponse.json({ status: true });
}
