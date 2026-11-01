import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { calcularMetricas, compararPeriodos } from "@/modules/metricas/calcular";
import { carregarContextoMetricas, carregarMensagens } from "@/modules/metricas/carregar";
import { csvPorDia, expedienteDe, lerPeriodo, type Periodo } from "@/modules/metricas/periodo";
import { z } from "zod";

/**
 * GET /api/metricas/[sessionId]?de=AAAA-MM-DD&ate=AAAA-MM-DD[&formato=csv][&comparar=1]
 * Métricas de atendimento da sessão no período (datas de São Paulo). O dono da sessão (ou quem tem acesso a ela) pode ver.
 * Com comparar=1 devolve também o período anterior (mesma duração, terminando na véspera de `de`) e as variações.
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
    const comparar = z.literal("1").nullable().safeParse(q.get("comparar"));
    if (!comparar.success) return NextResponse.json({ status: false, message: "Parâmetro comparar inválido. Use comparar=1." }, { status: 400 });
    if (comparar.data && formato === "csv") return NextResponse.json({ status: false, message: "O CSV não aceita comparar: ele traz só a série diária do período atual." }, { status: 400 });

    // o canAccessSession aceita o id do banco ou a string do Baileys; as métricas sempre usam a string do Baileys
    const sessao = await prisma.session.findFirst({ where: { OR: [{ sessionId }, { id: sessionId }] }, select: { id: true, sessionId: true } });
    if (!sessao) return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });

    try {
        const cfg = await prisma.agenteConfig.findUnique({ where: { sessionId: sessao.sessionId }, select: { diasAbertos: true, horaAbre: true, horaFecha: true } });
        const expediente = expedienteDe(cfg);
        const calcular = async (p: Periodo) => {
            // um dia antes do período, para não cortar uma demanda que começou na borda
            const desde = new Date(p.inicio.getTime() - 86_400_000);
            const mensagens = await carregarMensagens({ dbSessionId: sessao.id, sessionId: sessao.sessionId, desde, ate: p.fim });
            const contatos = [...new Set(mensagens.map((m) => m.contato))];
            const contexto = await carregarContextoMetricas({ dbSessionId: sessao.id, sessionId: sessao.sessionId, contatos, inicio: p.inicio, ate: p.fim });
            // vendasFechadas e passagensParaPessoa ficam em 0 até as tabelas do atendente existirem
            return calcularMetricas(mensagens, { inicio: p.inicio, fim: p.fim, expediente, ...contexto });
        };
        const relatorio = await calcular(periodo);

        if (comparar.data) {
            const fimAnterior = new Date(periodo.inicio.getTime() - 86_400_000).toISOString().slice(0, 10);
            const inicioAnterior = new Date(periodo.inicio.getTime() - periodo.dias * 86_400_000).toISOString().slice(0, 10);
            const anteriorLido = lerPeriodo({ de: inicioAnterior, ate: fimAnterior });
            if (!anteriorLido.ok) return NextResponse.json({ status: false, message: anteriorLido.mensagem }, { status: 400 });
            const anterior = await calcular(anteriorLido.periodo);
            return NextResponse.json({ status: true, data: { atual: relatorio, anterior, variacoes: compararPeriodos(relatorio, anterior) } });
        }

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
