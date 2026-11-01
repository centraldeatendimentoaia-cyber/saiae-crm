import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAtendente, respostaErroAcao, type Ctx } from "@/modules/atendente/guard-rota";
import { publicar } from "@/modules/atendente/armazenamento";
import { limparCacheAtendente } from "@/modules/atendente/integracao";

/** POST: publica o rascunho como a próxima versão. */
export async function POST(request: NextRequest, { params }: Ctx) {
    const { sessionId } = await params;
    const g = await guardAtendente(request, sessionId);
    if ("negado" in g) return g.negado;
    if (!(await prisma.atendenteTreino.findUnique({ where: { sessionId }, select: { sessionId: true } }))) {
        return NextResponse.json({ status: false, message: "Não há rascunho para publicar. Salve o treino primeiro." }, { status: 409 });
    }
    try {
        const versao = await publicar(sessionId);
        limparCacheAtendente(sessionId);
        return NextResponse.json({ status: true, data: { versao } });
    } catch (e) {
        return respostaErroAcao(e);
    }
}
