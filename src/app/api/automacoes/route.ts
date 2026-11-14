import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessSession, getAuthenticatedUser } from "@/lib/api-auth";
import { lerCorpo } from "@/lib/validate";
import { criarFluxo, listarFluxos } from "@/modules/automacoes/servico";

const naoAutorizado = () => NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });

const schema = z.object({ sessionId: z.string().min(1), name: z.string().min(1).max(120), draft: z.record(z.string(), z.unknown()).optional() });

// GET: fluxos do usuário
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return naoAutorizado();
    return NextResponse.json({ status: true, data: { flows: await listarFluxos(user.id) } });
}

// POST: cria um fluxo (rascunho) numa sessão a que o usuário tem acesso
export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return naoAutorizado();
    const lido = await lerCorpo(request, schema);
    if (!lido.ok) return lido.response;
    if (!(await canAccessSession(user.id, user.role, lido.data.sessionId)))
        return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden" }, { status: 403 });
    const flow = await criarFluxo({ userId: user.id, ...lido.data });
    return NextResponse.json({ status: true, data: { id: flow.id } }, { status: 201 });
}
