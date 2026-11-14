import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { lerCorpo } from "@/lib/validate";
import { ErroAutomacao, atualizarRascunho, obterFluxo } from "@/modules/automacoes/servico";

const schema = z.object({ draft: z.record(z.string(), z.unknown()) });

// GET: fluxo do usuário com o rascunho (404 para fluxo de outro usuário)
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    try {
        return NextResponse.json({ status: true, data: await obterFluxo(user.id, (await params).id) });
    } catch (e) {
        if (e instanceof ErroAutomacao) return NextResponse.json({ status: false, message: e.codigo, error: e.codigo }, { status: 404 });
        throw e;
    }
}

// PUT: substitui o rascunho do fluxo do usuário (só vira executável ao publicar, depois do validador de grafo)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    const lido = await lerCorpo(request, schema);
    if (!lido.ok) return lido.response;
    try {
        await atualizarRascunho(user.id, (await params).id, lido.data.draft);
        return NextResponse.json({ status: true, message: "rascunho atualizado" });
    } catch (e) {
        if (e instanceof ErroAutomacao) return NextResponse.json({ status: false, message: e.codigo, error: e.codigo }, { status: 404 });
        throw e;
    }
}
