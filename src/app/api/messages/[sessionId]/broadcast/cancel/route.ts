import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

/** POST: cancela o disparo em andamento deste número (o envio para na próxima mensagem). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const { sessionId } = await params;
    if (!(await canAccessSession(user.id, user.role, sessionId))) return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });

    const r = await prisma.broadcastLog.updateMany({ where: { sessionId, status: "running" }, data: { status: "cancelled", completedAt: new Date() } });
    return NextResponse.json({ status: true, data: { cancelled: r.count } });
}
