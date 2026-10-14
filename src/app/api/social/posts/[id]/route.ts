import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";

/** DELETE /api/social/posts/:id — cancela/remove (não mexe no que já foi publicado na rede). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    // PUBLISHING não pode sumir: a Meta pode estar aceitando o post agora
    const r = await prisma.scheduledPost.deleteMany({ where: { id, userId: user.id, status: { not: "PUBLISHING" } } });
    if (r.count !== 1) return NextResponse.json({ status: false, message: "Não encontrada ou publicando agora." }, { status: 404 });
    return NextResponse.json({ status: true });
}
