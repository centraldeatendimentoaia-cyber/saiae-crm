import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { limiteConhecido, mesSaoPaulo, prismaConsumo } from "@/modules/ia-atendimento/consumo";
import { parseTimestamp, timestampInWindow, verifyComandaSignature } from "@/modules/integracao/comanda/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TAG = "IaConsumoRota";
const CODIGO_LOJA = /^[A-Z0-9]{6}$/;

/** Mesmo segredo da leitura de contexto (COMANDA_IA_SEGREDO). Rotação: lista separada por vírgula; cada um com 16+ caracteres. */
function segredos(env: Record<string, string | undefined> = process.env): string[] {
    return (env.COMANDA_IA_SEGREDO ?? "").split(",").map((s) => s.trim()).filter((s) => s.length >= 16);
}

const vazio = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });

/**
 * GET /api/integracao/comanda/v1/ia-consumo?codigo_loja=XXXXXX — quantas conversas a IA atendeu na loja no mês.
 * Rota pública em src/proxy.ts (caminho exato); a proteção é a assinatura HMAC `sha256=` + HMAC(segredo,
 * `${timestamp}.${codigo_loja}`) com janela de 5 min. 200 {mes, conversas, limite|null}; loja desconhecida = 0 e null;
 * 401 e 400 sem corpo; 503 sem corpo se COMANDA_IA_SEGREDO não estiver configurado. Nunca registra o código da loja.
 */
export async function GET(request: NextRequest) {
    const chaves = segredos();
    if (chaves.length === 0) {
        logger.error(TAG, "COMANDA_IA_SEGREDO ausente ou inválido");
        return vazio(503);
    }

    const codigo = request.nextUrl.searchParams.get("codigo_loja") ?? "";
    const timestampHeader = request.headers.get("x-saiae-timestamp");
    const ts = parseTimestamp(timestampHeader);
    if (ts === null || !timestampInWindow(ts) || !verifyComandaSignature(Buffer.from(codigo, "utf8"), timestampHeader!, request.headers.get("x-saiae-signature"), chaves)) {
        logger.warn(TAG, "recusado: autenticação inválida");
        return vazio(401);
    }
    if (!CODIGO_LOJA.test(codigo)) return vazio(400);

    const mes = mesSaoPaulo(new Date());
    try {
        const conversas = await prismaConsumo.ler(codigo, mes);
        return NextResponse.json({ mes, conversas, limite: limiteConhecido(codigo) }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
        logger.error(TAG, `falha ao ler o consumo: ${e instanceof Error ? e.name : "erro"}`);
        return vazio(500);
    }
}
