import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardAtendente, respostaErroAcao, type Ctx } from "@/modules/atendente/guard-rota";
import { aprovarSugestao, descartarSugestao, ErroSugestao, listarSugestoesPendentes } from "@/modules/atendente/sugestoes";

const Corpo = z.discriminatedUnion("acao", [
    z.object({ id: z.string().min(1).max(64), acao: z.literal("aprovar"), destino: z.enum(["exemplo", "base"]) }),
    z.object({ id: z.string().min(1).max(64), acao: z.literal("descartar") }),
]);

/** GET: sugestões pendentes da sessão (as 50 mais novas). */
export async function GET(request: NextRequest, { params }: Ctx) {
    const { sessionId } = await params;
    const g = await guardAtendente(request, sessionId);
    if ("negado" in g) return g.negado;
    return NextResponse.json({ status: true, data: await listarSugestoesPendentes(sessionId) });
}

/** POST: aprova (vai para o rascunho, nunca publica) ou descarta uma sugestão. */
export async function POST(request: NextRequest, { params }: Ctx) {
    const { sessionId } = await params;
    const g = await guardAtendente(request, sessionId);
    if ("negado" in g) return g.negado;
    const r = Corpo.safeParse(await request.json().catch(() => null));
    if (!r.success) return NextResponse.json({ status: false, message: "Pedido inválido: informe a sugestão, a ação (aprovar ou descartar) e, para aprovar, o destino (exemplo ou base)." }, { status: 400 });
    try {
        if (r.data.acao === "aprovar") await aprovarSugestao(sessionId, r.data.id, r.data.destino);
        else await descartarSugestao(sessionId, r.data.id);
        // Sem limparCacheAtendente: aprovar muda só o rascunho; o publicado (o que a atendente usa) não muda.
        return NextResponse.json({ status: true });
    } catch (e) {
        if (e instanceof ErroSugestao) return NextResponse.json({ status: false, message: e.message }, { status: e.status });
        return respostaErroAcao(e);
    }
}
