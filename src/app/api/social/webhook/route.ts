import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { safeEqual, verifyMetaSignature } from "@/lib/whatsapp-webhook";
import { normalizarWebhookSocial } from "@/modules/automacoes/gatilhos/eventos";
import { depsReais } from "@/modules/automacoes/gatilhos/real";
import { processarEventoSocial } from "@/modules/automacoes/gatilhos/roteador";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;
const TAG = "SocialWebhook";

/**
 * Webhook de Instagram/Messenger (DM e comentário) para os gatilhos de automação. Rota pública (src/proxy.ts):
 * a proteção é o token de verificação (GET) e a assinatura HMAC do corpo (POST), como no webhook da Cloud API.
 * Variáveis: SOCIAL_WEBHOOK_VERIFY_TOKEN e SOCIAL_META_APP_SECRET. Os gatilhos em si só agem com flag + permissão
 * (ver gatilhos/catalogo.ts); sem isso o evento é aceito (200) e descartado.
 */
export async function GET(request: NextRequest) {
    const esperado = process.env.SOCIAL_WEBHOOK_VERIFY_TOKEN;
    if (!esperado) return new NextResponse("Forbidden", { status: 403 });
    const p = request.nextUrl.searchParams;
    const token = p.get("hub.verify_token"), challenge = p.get("hub.challenge");
    if (p.get("hub.mode") === "subscribe" && token && challenge && challenge.length <= 200 && safeEqual(token, esperado))
        return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
    return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
    const secret = process.env.SOCIAL_META_APP_SECRET;
    if (!secret) return NextResponse.json({ error: "Webhook não configurado" }, { status: 503 });
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ error: "Corpo grande demais" }, { status: 413 });
    const raw = Buffer.from(await request.arrayBuffer());
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Corpo grande demais" }, { status: 413 });
    if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
        logger.warn(TAG, "assinatura inválida");
        return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
    }
    let payload: unknown;
    try { payload = JSON.parse(raw.toString("utf8")); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

    const eventos = normalizarWebhookSocial(payload);
    const deps = depsReais();
    // 200 rápido: falha de processamento nunca vira erro para a Meta (ela reentregaria o lote)
    void Promise.all(eventos.map((e) => processarEventoSocial(e, deps))).catch((e) => logger.warn(TAG, `falha ao processar evento: ${e instanceof Error ? e.name : "erro"}`));
    return NextResponse.json({ received: true });
}
