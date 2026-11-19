import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { lerPeriodo } from "@/modules/metricas/periodo";
import { carregarEventos } from "@/modules/resultados/carregar";
import { consolidarFunil } from "@/modules/resultados/funil";
import { csvFunil } from "@/modules/resultados/csv";
import { resolverSessao, resultadosAtivo } from "@/modules/resultados/sessao";
import { ORIGENS, type Origem } from "@/modules/resultados/tipos";

/**
 * GET /api/resultados/[sessionId]?de=AAAA-MM-DD&ate=AAAA-MM-DD[&origem=anuncio|...|desconhecido][&formato=csv]
 * Funil de resultados da sessão (leads, conversas, respostas, agendamentos, comparecimentos, vendas), cada número com
 * confirmado/inferido/desconhecido separados. Nunca devolve conteúdo de mensagem nem telefone.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    if (!resultadosAtivo()) return NextResponse.json({ status: false, message: "Recurso desativado." }, { status: 404 });
    const { sessionId } = await params;
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    if (!(await canAccessSession(user.id, user.role, sessionId))) return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });

    const q = request.nextUrl.searchParams;
    const lido = lerPeriodo({ de: q.get("de"), ate: q.get("ate") });
    if (!lido.ok) return NextResponse.json({ status: false, message: lido.mensagem }, { status: 400 });
    const formato = q.get("formato");
    if (formato !== null && formato !== "json" && formato !== "csv") return NextResponse.json({ status: false, message: "Formato inválido. Use json ou csv." }, { status: 400 });
    const origemParam = q.get("origem");
    if (origemParam !== null && !(ORIGENS as readonly string[]).includes(origemParam)) return NextResponse.json({ status: false, message: "Origem inválida." }, { status: 400 });

    const sessao = await resolverSessao(sessionId);
    if (!sessao) return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });

    try {
        const { periodo } = lido;
        const { eventos, importadosSemConversa } = await carregarEventos(sessao, periodo.inicio, periodo.fim);
        const funil = { ...consolidarFunil(eventos, origemParam as Origem | null), importadosSemConversa };
        if (formato === "csv") {
            return new NextResponse(csvFunil(funil), {
                status: 200,
                headers: {
                    "Content-Type": "text/csv; charset=utf-8",
                    "Content-Disposition": `attachment; filename="resultados-${periodo.de}-a-${periodo.ate}.csv"`,
                    "Cache-Control": "no-store",
                },
            });
        }
        return NextResponse.json({ status: true, data: { periodo: { de: periodo.de, ate: periodo.ate }, origem: origemParam, funil } });
    } catch (e) {
        logger.error("Resultados", "falha ao calcular os resultados:", e);
        return NextResponse.json({ status: false, message: "Não foi possível calcular os resultados agora." }, { status: 500 });
    }
}
