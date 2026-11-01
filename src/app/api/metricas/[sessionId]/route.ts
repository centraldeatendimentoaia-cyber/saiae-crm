import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { calcularMetricas } from "@/modules/metricas/calcular";
import { carregarMensagens } from "@/modules/metricas/carregar";
import { csvPorDia, expedienteDe, lerPeriodo } from "@/modules/metricas/periodo";

/**
 * GET /api/metricas/[sessionId]?de=AAAA-MM-DD&ate=AAAA-MM-DD[&formato=csv]
 * Métricas de atendimento da sessão no período (datas de São Paulo). O dono da sessão (ou quem tem acesso a ela) pode ver.
 * Nunca devolve conteúdo de mensagem nem telefone: só contagens e tempos.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const { sessionId } = await params;
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    if (!(await canAccessSession(user.id, user.role, sessionId))) return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });

    const q = request.nextUrl.searchParams;
    const lido = lerPeriodo({ de: q.get("de"), ate: q.get("ate") });
    if (!lido.ok) return NextResponse.json({ status: false, message: lido.mensagem }, { status: 400 });
    const formato = q.get("formato");
    if (formato !== null && formato !== "json" && formato !== "csv") return NextResponse.json({ status: false, message: "Formato inválido. Use json ou csv." }, { status: 400 });
    const { periodo } = lido;

    // o canAccessSession aceita o id do banco ou a string do Baileys; as métricas sempre usam a string do Baileys
    const sessao = await prisma.session.findFirst({ where: { OR: [{ sessionId }, { id: sessionId }] }, select: { id: true, sessionId: true } });
    if (!sessao) return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });

    try {
        const cfg = await prisma.agenteConfig.findUnique({ where: { sessionId: sessao.sessionId }, select: { diasAbertos: true, horaAbre: true, horaFecha: true } });
        // um dia antes do período, para não cortar uma demanda que começou na borda
        const desde = new Date(periodo.inicio.getTime() - 86_400_000);
        const mensagens = await carregarMensagens({ dbSessionId: sessao.id, sessionId: sessao.sessionId, desde, ate: periodo.fim });
        const relatorio = calcularMetricas(mensagens, { inicio: periodo.inicio, fim: periodo.fim, expediente: expedienteDe(cfg) });

        if (formato === "csv") {
            return new NextResponse(csvPorDia(relatorio.porDia), {
                status: 200,
                headers: {
                    "Content-Type": "text/csv; charset=utf-8",
                    "Content-Disposition": `attachment; filename="metricas-${periodo.de}-a-${periodo.ate}.csv"`,
                    "Cache-Control": "no-store",
                },
            });
        }
        return NextResponse.json({ status: true, data: relatorio });
    } catch (e) {
        logger.error("Metricas", "falha ao calcular as métricas:", e);
        return NextResponse.json({ status: false, message: "Não foi possível calcular as métricas agora." }, { status: 500 });
    }
}
