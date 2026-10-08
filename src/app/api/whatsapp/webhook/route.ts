import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { safeEqual, summarizeEvent, verifyMetaSignature } from "@/lib/whatsapp-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;
const TAG = "WhatsAppWebhook";

/**
 * Webhook da WhatsApp Cloud API (Meta). Rota pública (liberada em src/proxy.ts): a proteção é a
 * verificação por token (GET) e a assinatura HMAC do corpo (POST).
 *
 * Por ora só confirma o recebimento e registra tipo e contagem. NÃO registra conteúdo de mensagem
 * nem telefone e NÃO persiste nada. O processamento real vem com o WhatsAppProvider (SAI-003).
 *
 * Variáveis (definidas pelo dono no Railway, nunca no repositório):
 *   WHATSAPP_VERIFY_TOKEN  texto que o dono escolhe e cola também no painel da Meta
 *   WHATSAPP_APP_SECRET    "Chave secreta do app" do aplicativo da Meta
 */

/** Verificação do webhook: a Meta chama uma vez ao cadastrar a URL. */
export async function GET(request: NextRequest) {
    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!expectedToken) {
        logger.error(TAG, "WHATSAPP_VERIFY_TOKEN não configurada");
        return new NextResponse("Forbidden", { status: 403 });
    }

    const params = request.nextUrl.searchParams;
    const mode = params.get("hub.mode");
    const token = params.get("hub.verify_token");
    const challenge = params.get("hub.challenge");

    if (mode === "subscribe" && token && challenge && challenge.length <= 200 && safeEqual(token, expectedToken)) {
        return new NextResponse(challenge, {
            status: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
        });
    }

    logger.warn(TAG, "verificação recusada");
    return new NextResponse("Forbidden", { status: 403 });
}

/** Eventos: valida a assinatura, responde 200 rápido e registra só tipo e contagem. */
export async function POST(request: NextRequest) {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) {
        logger.error(TAG, "WHATSAPP_APP_SECRET não configurada");
        return NextResponse.json({ error: "Webhook não configurado" }, { status: 503 });
    }

    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) {
        return NextResponse.json({ error: "Corpo grande demais" }, { status: 413 });
    }

    const raw = Buffer.from(await request.arrayBuffer());
    if (raw.length > MAX_BODY_BYTES) {
        return NextResponse.json({ error: "Corpo grande demais" }, { status: 413 });
    }

    if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), appSecret)) {
        logger.warn(TAG, "assinatura inválida");
        return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
    }

    let payload: unknown;
    try {
        payload = JSON.parse(raw.toString("utf8"));
    } catch {
        return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }

    const s = summarizeEvent(payload);
    const fields = Object.entries(s.changes).map(([k, v]) => `${k}=${v}`).join(",") || "-";
    logger.info(TAG, `evento ${s.object}: entradas=${s.entries} campos=${fields} mensagens=${s.messages} status=${s.statuses}`);

    return NextResponse.json({ received: true });
}
