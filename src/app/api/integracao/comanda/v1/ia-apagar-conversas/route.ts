import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { apagarConversasDoCliente } from "@/modules/ia-atendimento/apagar";
import { parseTimestamp, timestampInWindow, verifyComandaSignature } from "@/modules/integracao/comanda/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_024;
const TAG = "IaApagarRota";
const corpoSchema = z.object({ codigo_loja: z.string().regex(/^[A-Z0-9]{6}$/), telefone: z.string().regex(/^[0-9]{10,13}$/) });

/** Mesmo segredo do ia-contexto (COMANDA_IA_SEGREDO). Rotação: lista separada por vírgula; cada um com 16+ caracteres. */
function segredos(env: Record<string, string | undefined> = process.env): string[] {
    return (env.COMANDA_IA_SEGREDO ?? "").split(",").map((s) => s.trim()).filter((s) => s.length >= 16);
}

const vazio = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });

/**
 * POST /api/integracao/comanda/v1/ia-apagar-conversas {codigo_loja, telefone}. Rota pública em src/proxy.ts (caminho exato);
 * a proteção é a assinatura HMAC (timestamp + "." + corpo, janela de 5 min). Apaga as conversas da IA daquele telefone nessa
 * loja (e a conversa "sem loja" do mesmo telefone). Idempotente: 200 {apagadas: n}, inclusive 0. 401/400/413/503 sem corpo.
 * Nunca registra o código da loja nem o telefone.
 */
export async function POST(request: NextRequest) {
    const chaves = segredos();
    if (chaves.length === 0) {
        logger.error(TAG, "COMANDA_IA_SEGREDO ausente ou inválido");
        return vazio(503);
    }
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return vazio(413);
    const raw = Buffer.from(await request.arrayBuffer());
    if (raw.length > MAX_BODY_BYTES) return vazio(413);

    const timestampHeader = request.headers.get("x-saiae-timestamp");
    const ts = parseTimestamp(timestampHeader);
    if (ts === null || !timestampInWindow(ts) || !verifyComandaSignature(raw, timestampHeader!, request.headers.get("x-saiae-signature"), chaves)) {
        logger.warn(TAG, "recusado: autenticação inválida");
        return vazio(401);
    }

    let json: unknown;
    try {
        json = JSON.parse(raw.toString("utf8"));
    } catch {
        return vazio(400);
    }
    const corpo = corpoSchema.safeParse(json);
    if (!corpo.success) return vazio(400);

    try {
        const apagadas = await apagarConversasDoCliente(corpo.data.codigo_loja, corpo.data.telefone);
        if (apagadas === null) return vazio(400);
        return NextResponse.json({ apagadas }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
        logger.error(TAG, `falha ao apagar: ${e instanceof Error ? e.name : "erro"}`);
        return vazio(500);
    }
}
