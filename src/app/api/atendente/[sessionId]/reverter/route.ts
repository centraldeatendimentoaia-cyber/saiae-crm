import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guardAtendente, type Ctx } from "@/modules/atendente/guard-rota";
import { reverter } from "@/modules/atendente/armazenamento";
import { limparCacheAtendente } from "@/modules/atendente/integracao";

const corpo = z.object({ versao: z.number().int().min(1) });

/** POST {versao}: volta para uma versão publicada (vira rascunho e publicada). */
export async function POST(request: NextRequest, { params }: Ctx) {
    const { sessionId } = await params;
    const g = await guardAtendente(request, sessionId);
    if ("negado" in g) return g.negado;
    const p = corpo.safeParse(await request.json().catch(() => null));
    if (!p.success) return NextResponse.json({ status: false, message: "Informe o número da versão." }, { status: 400 });
    const { versao } = p.data;
    if (!(await prisma.atendenteVersao.findUnique({ where: { sessionId_versao: { sessionId, versao } }, select: { id: true } }))) {
        return NextResponse.json({ status: false, message: `A versão ${versao} não existe nesta sessão.` }, { status: 404 });
    }
    await reverter(sessionId, versao);
    limparCacheAtendente(sessionId);
    return NextResponse.json({ status: true });
}
