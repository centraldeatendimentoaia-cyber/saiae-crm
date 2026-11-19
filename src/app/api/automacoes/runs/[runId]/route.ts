import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { ErroAutomacao, inspecionarRun } from "@/modules/automacoes/servico";

// GET: estado, contexto e passos de uma execução do usuário
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    try {
        return NextResponse.json({ status: true, data: { run: await inspecionarRun(user.id, (await params).runId) } });
    } catch (e) {
        if (e instanceof ErroAutomacao) return NextResponse.json({ status: false, message: e.codigo, error: e.codigo }, { status: 404 });
        throw e;
    }
}
