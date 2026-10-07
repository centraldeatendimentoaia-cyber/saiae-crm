import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";

/** GET /api/uploads/:id — mostra a imagem enviada (só o dono). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const row = await prisma.mediaFile.findUnique({ where: { id } });
    if (!row || (row.userId !== user.id && user.role !== "SUPERADMIN")) return NextResponse.json({ status: false, message: "Not found" }, { status: 404 });
    return new Response(new Uint8Array(row.data), { headers: { "Content-Type": row.mime, "Cache-Control": "private, max-age=3600" } });
}
