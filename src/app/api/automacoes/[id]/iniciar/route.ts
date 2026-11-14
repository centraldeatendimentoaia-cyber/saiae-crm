import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { lerCorpo } from "@/lib/validate";
import { ErroAutomacao, iniciarRun } from "@/modules/automacoes/servico";

const schema = z.object({ contactKey: z.string().min(1).max(191), dedupeKey: z.string().max(120).optional() });

// POST: gatilho de teste manual/interno (não existe gatilho de webhook/Meta neste sprint)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    const lido = await lerCorpo(request, schema);
    if (!lido.ok) return lido.response;
    try {
        const r = await iniciarRun({ userId: user.id, flowId: (await params).id, ...lido.data });
        if (r.ok) return NextResponse.json({ status: true, data: { runId: r.runId } }, { status: 201 });
        return NextResponse.json({ status: false, message: r.motivo, error: r.motivo, data: { runId: r.runId } }, { status: 409 });
    } catch (e) {
        if (e instanceof ErroAutomacao) return NextResponse.json({ status: false, message: e.codigo, error: e.codigo }, { status: e.codigo === "nao_encontrado" ? 404 : 400 });
        throw e;
    }
}
