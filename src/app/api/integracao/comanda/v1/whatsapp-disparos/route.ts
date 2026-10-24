import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { parseTimestamp, timestampInWindow, verifyComandaSignature } from "@/modules/integracao/comanda/signature";
import { segredosWhatsapp } from "@/modules/integracao/comanda/sessao-evento";
import { executarAcaoDisparo, validarPedidoDisparo } from "@/modules/disparos/campanha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 262_144;
const TAG = "ComandaWhatsAppDisparos";

/** Limite por barraca: o Sai aê consulta o QR a cada poucos segundos, então a folga é grande. */
const LIMITE_POR_MINUTO = 30;
const janelas = new Map<string, { inicio: number; usos: number }>();

function acimaDoLimite(barracaId: string, agora: number = Date.now()): boolean {
    const j = janelas.get(barracaId);
    if (!j || agora - j.inicio >= 60_000) {
        if (janelas.size > 10_000) janelas.clear();
        janelas.set(barracaId, { inicio: agora, usos: 1 });
        return false;
    }
    j.usos++;
    return j.usos > LIMITE_POR_MINUTO;
}

/**
 * POST /api/integracao/comanda/v1/whatsapp-disparos. Rota pública em src/proxy.ts (caminho exato); a proteção é a
 * assinatura HMAC com o segredo de plataforma COMANDA_WHATSAPP_SEGREDO e a janela de 5 min. Ordem: não configurado
 * (503) → tamanho (413) → cabeçalhos, janela e assinatura (401, resposta idêntica) → JSON (400) → contrato (422) →
 * limite (429) → ação.
 *
 * Só opera na sessão da barraca do corpo. O QR é o texto bruto e só sai em `aguardando_qr`. Nunca registra QR,
 * número nem credenciais.
 */
export async function POST(request: NextRequest) {
    const secrets = segredosWhatsapp();
    if (secrets.length === 0) {
        logger.error(TAG, "COMANDA_WHATSAPP_SEGREDO ausente ou inválido");
        return NextResponse.json({ error: "Integração não configurada" }, { status: 503 });
    }

    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
        return NextResponse.json({ error: "Corpo grande demais" }, { status: 413 });
    }
    const raw = Buffer.from(await request.arrayBuffer());
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Corpo grande demais" }, { status: 413 });

    const unauthorized = (reason: string) => {
        logger.warn(TAG, `recusado: ${reason}`); // motivo fixo: nunca ecoa valores do pedido
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    };
    const timestampHeader = request.headers.get("x-saiae-timestamp");
    const signatureHeader = request.headers.get("x-saiae-signature");
    const ts = parseTimestamp(timestampHeader);
    if (ts === null || !signatureHeader) return unauthorized("cabeçalhos de autenticação ausentes ou inválidos");
    if (!timestampInWindow(ts)) return unauthorized("timestamp fora da janela de 5 minutos");
    if (!verifyComandaSignature(raw, timestampHeader!, signatureHeader, secrets)) return unauthorized("assinatura inválida");

    let json: unknown;
    try {
        json = JSON.parse(raw.toString("utf8"));
    } catch {
        return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }
    const pedido = validarPedidoDisparo(json);
    if (!pedido.ok) return NextResponse.json({ error: "Corpo fora do contrato" }, { status: 422 });
    if (request.headers.get("x-saiae-event-id") !== pedido.dados.request_id) {
        return NextResponse.json({ error: "X-Saiae-Event-Id diferente do request_id" }, { status: 422 });
    }

    if (acimaDoLimite(pedido.dados.barraca_id)) {
        return NextResponse.json({ error: "Muitas chamadas" }, { status: 429, headers: { "retry-after": "30" } });
    }

    try {
        const resposta = await executarAcaoDisparo(pedido.dados);
        return NextResponse.json(resposta);
    } catch (e) {
        logger.error(TAG, `ação falhou: ${e instanceof Error ? e.name : "erro"}`);
        return NextResponse.json({ error: "Falha ao executar a ação" }, { status: 502 });
    }
}
