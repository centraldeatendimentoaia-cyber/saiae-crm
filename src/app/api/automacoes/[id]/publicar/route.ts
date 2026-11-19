import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { ErroAutomacao, publicarFluxo } from "@/modules/automacoes/servico";

// POST: valida o grafo e publica o rascunho como nova versão imutável
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    try {
        const v = await publicarFluxo(user.id, (await params).id);
        return NextResponse.json({ status: true, data: { versionId: v.id, version: v.version } }, { status: 201 });
    } catch (e) {
        if (e instanceof ErroAutomacao) {
            const status = e.codigo === "nao_encontrado" ? 404 : 400;
            return NextResponse.json({ status: false, message: e.codigo, error: e.codigo, details: e.detalhes }, { status });
        }
        throw e;
    }
}
