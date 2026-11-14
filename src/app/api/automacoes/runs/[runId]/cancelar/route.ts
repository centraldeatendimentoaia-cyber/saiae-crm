import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { cancelarRun } from "@/modules/automacoes/servico";

// POST: cancela uma execução ativa do usuário
export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    const ok = await cancelarRun(user.id, (await params).runId, "manual");
    return ok
        ? NextResponse.json({ status: true, message: "cancelada" })
        : NextResponse.json({ status: false, message: "execução não encontrada ou já encerrada", error: "nao_encontrada" }, { status: 404 });
}
