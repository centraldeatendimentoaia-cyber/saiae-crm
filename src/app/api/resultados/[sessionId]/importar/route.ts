import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getAuthenticatedUser, isSessionOwner } from "@/lib/api-auth";
import { interpretarImportacao, MAX_BYTES_IMPORTACAO } from "@/modules/resultados/agenda";
import { gravarImportacao } from "@/modules/resultados/carregar";

const corpo = z.object({ formato: z.enum(["csv", "json"]), conteudo: z.string().min(1).max(MAX_BYTES_IMPORTACAO) });

/**
 * POST /api/resultados/[sessionId]/importar  { formato: "csv" | "json", conteudo: "<texto do arquivo>" }
 * Importação controlada de agenda/vendas: só o dono da sessão, validada linha a linha e idempotente. Não chama nenhuma agenda real.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const { sessionId } = await params;
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    if (!(await isSessionOwner(user.id, user.role, sessionId))) return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });

    const bruto = await request.text();
    if (bruto.length > MAX_BYTES_IMPORTACAO * 2) return NextResponse.json({ status: false, message: "Arquivo grande demais (máximo 1 MB)." }, { status: 413 });
    let json: unknown;
    try { json = JSON.parse(bruto); } catch { return NextResponse.json({ status: false, message: "Corpo inválido." }, { status: 400 }); }
    const p = corpo.safeParse(json);
    if (!p.success) return NextResponse.json({ status: false, message: "Informe formato (csv ou json) e conteudo." }, { status: 400 });

    const sessao = await prisma.session.findFirst({ where: { OR: [{ id: sessionId }, { sessionId }] }, select: { id: true, sessionId: true, userId: true } });
    if (!sessao) return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });

    const lido = interpretarImportacao(p.data.formato, p.data.conteudo);
    if (!lido.ok) return NextResponse.json({ status: false, message: lido.mensagem }, { status: 400 });
    try {
        const { eventos, rejeitadas, recebidas } = lido.resultado;
        const g = await gravarImportacao(sessao, eventos, p.data.formato === "csv" ? "importacao_csv" : "importacao_json");
        return NextResponse.json({ status: true, data: { recebidas, validas: eventos.length, novos: g.novos, repetidos: g.repetidos, rejeitadas: rejeitadas.slice(0, 50), totalRejeitadas: rejeitadas.length } });
    } catch (e) {
        logger.error("Resultados", "falha ao importar:", e);
        return NextResponse.json({ status: false, message: "Não foi possível importar agora." }, { status: 500 });
    }
}
