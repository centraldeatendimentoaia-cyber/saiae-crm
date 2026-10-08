import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getProvider } from "@/modules/whatsapp/provider";
import { CloudApiError } from "@/modules/whatsapp/cloud/errors";
import { parseTimestamp, timestampInWindow, verifyComandaSignature } from "@/modules/integracao/comanda/signature";
import { jaEnviado, marcarEnviado, validarPedidoCodigo } from "@/modules/integracao/comanda/codigo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_096;
const TAG = "ComandaCodigo";
const TEMPLATE = "codigo_verificacao";

/** Segredo de PLATAFORMA (não por barraca). Rotação: lista separada por vírgula; cada um com 16+ caracteres. */
function loadCodigoSecrets(env: Record<string, string | undefined> = process.env): string[] {
    return (env.COMANDA_CODIGO_SECRET ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length >= 16);
}

/**
 * POST /api/integracao/comanda/v1/codigo-verificacao. Rota pública em src/proxy.ts (caminho exato); a proteção é a
 * assinatura HMAC (mesma dos eventos) e a janela de 5 min. Ordem: não configurado (503) → tamanho (413) →
 * cabeçalhos, janela e assinatura (401) → JSON (400) → schema (422) → idempotência → envio.
 *
 * Nunca registra telefone nem código: o log tem só o resultado e o tipo do erro.
 */
export async function POST(request: NextRequest) {
    const secrets = loadCodigoSecrets();
    if (secrets.length === 0) {
        logger.error(TAG, "COMANDA_CODIGO_SECRET ausente ou inválida");
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
    const pedido = validarPedidoCodigo(json);
    if (!pedido.ok) return NextResponse.json({ error: "Corpo fora do contrato" }, { status: 422 });
    const { telefone, codigo, request_id } = pedido.dados;
    if (request.headers.get("x-saiae-event-id") !== request_id) {
        return NextResponse.json({ error: "X-Saiae-Event-Id diferente do request_id" }, { status: 422 });
    }

    if (jaEnviado(request_id)) {
        logger.info(TAG, "pedido de código duplicado");
        return NextResponse.json({ enviado: true, duplicate: true });
    }

    // Sem WHATSAPP_CLOUD_SESSION_ID nunca cai para o Baileys: o código não pode sair por outro canal.
    const sessionId = process.env.WHATSAPP_CLOUD_SESSION_ID?.split(",")[0]?.trim();
    const provider = sessionId ? getProvider(sessionId) : null;
    if (!provider || !provider.capabilities.templates || !provider.sendTemplate) {
        logger.error(TAG, "sessão Cloud API indisponível");
        return NextResponse.json({ error: "Envio indisponível" }, { status: 503 });
    }

    try {
        await provider.sendTemplate(`55${telefone}`, {
            name: TEMPLATE,
            languageCode: "pt_BR",
            bodyParameters: [codigo],
            buttonParameters: [codigo], // modelo de autenticação: o código também vai no botão "copiar código"
        });
    } catch (e) {
        if (e instanceof CloudApiError) {
            logger.warn(TAG, `Meta recusou o envio do código: ${e.kind}${e.code !== null ? ` codigo=${e.code}` : ""}`);
            const status = e.kind === "undeliverable" || e.kind === "template" || e.kind === "invalid_request" || e.kind === "unsupported" ? 422 : e.kind === "rate_limit" ? 429 : 502;
            return NextResponse.json({ error: "Envio recusado" }, { status });
        }
        logger.error(TAG, "falha inesperada ao enviar o código");
        return NextResponse.json({ error: "Falha ao enviar" }, { status: 502 });
    }

    marcarEnviado(request_id);
    logger.info(TAG, "código enviado");
    return NextResponse.json({ enviado: true });
}
