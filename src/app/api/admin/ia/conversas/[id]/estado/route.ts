import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirSuperadmin } from "@/lib/admin-auth";
import { prismaStore } from "@/modules/ia-atendimento/store";

/**
 * POST /api/admin/ia/conversas/:id/estado  { acao: "pausar" | "liberar", horas?: 1..72 }
 * pausar: a IA fica calada nesta conversa (padrão 12 h, como no "chamar a equipe"). liberar: a IA volta a atender.
 * Só SUPERADMIN.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const negado = await exigirSuperadmin(request);
    if (negado) return negado;
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const existe = await prisma.iaConversa.findUnique({ where: { id }, select: { id: true } });
    if (!existe) return NextResponse.json({ status: false, message: "Not found" }, { status: 404 });

    if (body.acao === "pausar") {
        const horas = Math.min(Math.max(Math.round(Number(body.horas)) || 12, 1), 72);
        const ate = new Date(Date.now() + horas * 3_600_000);
        await prismaStore.pausar(id, ate);
        return NextResponse.json({ status: true, data: { estado: "humano", pausadaAte: ate } });
    }
    if (body.acao === "liberar") {
        await prismaStore.retomar(id);
        return NextResponse.json({ status: true, data: { estado: "ia", pausadaAte: null } });
    }
    return NextResponse.json({ status: false, message: "acao inválida (use pausar ou liberar)" }, { status: 400 });
}
