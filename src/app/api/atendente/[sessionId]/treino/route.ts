import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAtendente, type Ctx } from "@/modules/atendente/guard-rota";
import { salvarRascunho } from "@/modules/atendente/armazenamento";
import { TreinoSchema } from "@/modules/atendente/treino";
import { mensagemErroTreino } from "@/modules/atendente/editor";

/** GET: rascunho (ou null), versão publicada e lista de versões. */
export async function GET(request: NextRequest, { params }: Ctx) {
    const { sessionId } = await params;
    const g = await guardAtendente(request, sessionId);
    if ("negado" in g) return g.negado;
    const [t, versoes] = await Promise.all([
        prisma.atendenteTreino.findUnique({ where: { sessionId } }),
        prisma.atendenteVersao.findMany({ where: { sessionId }, orderBy: { versao: "desc" }, take: 50, select: { versao: true, criadoEm: true } }),
    ]);
    return NextResponse.json({ status: true, data: { rascunho: t?.rascunho ?? null, publicadoVersao: t?.publicadoVersao ?? null, versoes } });
}

/** PUT: valida com TreinoSchema e salva o rascunho. */
export async function PUT(request: NextRequest, { params }: Ctx) {
    const { sessionId } = await params;
    const g = await guardAtendente(request, sessionId);
    if ("negado" in g) return g.negado;
    const sessao = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!sessao) return NextResponse.json({ status: false, message: "Sessão não encontrada" }, { status: 404 });
    const r = TreinoSchema.safeParse(await request.json().catch(() => null));
    if (!r.success) return NextResponse.json({ status: false, message: mensagemErroTreino(r.error) }, { status: 400 });
    await salvarRascunho(sessionId, r.data);
    return NextResponse.json({ status: true });
}
