import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { getAuthenticatedUser, isSessionOwner } from "@/lib/api-auth";
import { interpretarImportacao, MAX_BYTES_IMPORTACAO } from "@/modules/resultados/agenda";
import { gravarImportacao } from "@/modules/resultados/carregar";
import { desfazerImportacao } from "@/modules/resultados/limpeza";
import { resolverSessao, resultadosAtivo } from "@/modules/resultados/sessao";

const corpo = z.object({ formato: z.enum(["csv", "json"]), conteudo: z.string().min(1).max(MAX_BYTES_IMPORTACAO) });

/**
 * POST /api/resultados/[sessionId]/importar  { formato: "csv" | "json", conteudo: "<texto do arquivo>" }
 * Importação controlada de agenda/vendas: só o dono da sessão, validada linha a linha e idempotente. Não chama nenhuma agenda real.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    if (!resultadosAtivo()) return NextResponse.json({ status: false, message: "Recurso desativado." }, { status: 404 });
    const { sessionId } = await params;
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    if (!(await isSessionOwner(user.id, user.role, sessionId))) return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });

    // recusa antes de ler o corpo quando o cabeçalho já declara tamanho acima do limite (o teste do texto lido continua valendo)
    const declarado = Number(request.headers.get("content-length") ?? 0);
    if (declarado > MAX_BYTES_IMPORTACAO * 2) return NextResponse.json({ status: false, message: "Arquivo grande demais (máximo 1 MB)." }, { status: 413 });
    const bruto = await request.text();
    if (bruto.length > MAX_BYTES_IMPORTACAO * 2) return NextResponse.json({ status: false, message: "Arquivo grande demais (máximo 1 MB)." }, { status: 413 });
    let json: unknown;
    try { json = JSON.parse(bruto); } catch { return NextResponse.json({ status: false, message: "Corpo inválido." }, { status: 400 }); }
    const p = corpo.safeParse(json);
    if (!p.success) return NextResponse.json({ status: false, message: "Informe formato (csv ou json) e conteudo." }, { status: 400 });

    const sessao = await resolverSessao(sessionId);
    if (!sessao) return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });

    const lido = interpretarImportacao(p.data.formato, p.data.conteudo);
    if (!lido.ok) return NextResponse.json({ status: false, message: lido.mensagem }, { status: 400 });
    try {
        const { eventos, rejeitadas, recebidas } = lido.resultado;
        const g = await gravarImportacao(sessao, eventos, p.data.formato === "csv" ? "importacao_csv" : "importacao_json");
        return NextResponse.json({ status: true, data: { importacaoId: g.importacaoId, avisos: lido.resultado.avisos, repetidasNoArquivo: lido.resultado.repetidasNoArquivo, recebidas, validas: eventos.length, novos: g.novos, repetidos: g.repetidos, rejeitadas: rejeitadas.slice(0, 50), totalRejeitadas: rejeitadas.length } });
    } catch (e) {
        logger.error("Resultados", "falha ao importar:", e);
        return NextResponse.json({ status: false, message: "Não foi possível importar agora." }, { status: 500 });
    }
}

/** DELETE /api/resultados/[sessionId]/importar?importacaoId=... : desfaz um lote importado. Só o dono; escopado por userId e sessão. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    if (!resultadosAtivo()) return NextResponse.json({ status: false, message: "Recurso desativado." }, { status: 404 });
    const { sessionId } = await params;
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    if (!(await isSessionOwner(user.id, user.role, sessionId))) return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
    const importacaoId = request.nextUrl.searchParams.get("importacaoId") ?? "";
    if (!/^[0-9a-f-]{36}$/.test(importacaoId)) return NextResponse.json({ status: false, message: "importacaoId inválido." }, { status: 400 });
    const sessao = await resolverSessao(sessionId);
    if (!sessao) return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });
    try {
        const r = await desfazerImportacao(sessao.userId, sessao.sessionId, importacaoId);
        return NextResponse.json({ status: true, data: { apagados: r.count } });
    } catch (e) {
        logger.error("Resultados", "falha ao desfazer importação:", e);
        return NextResponse.json({ status: false, message: "Não foi possível desfazer agora." }, { status: 500 });
    }
}
