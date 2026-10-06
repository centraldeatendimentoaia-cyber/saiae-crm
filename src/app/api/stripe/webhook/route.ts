import { NextRequest, NextResponse } from "next/server";
import { handleStripeEvent, verifyStripeSignature } from "@/lib/stripe-billing";

export const dynamic = "force-dynamic";

/** Webhook da Stripe: valida a assinatura e atualiza plano/assinatura da conta. */
export async function POST(request: NextRequest) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
        console.error("[stripe] STRIPE_WEBHOOK_SECRET não configurada");
        return NextResponse.json({ error: "Webhook não configurado" }, { status: 503 });
    }

    const rawBody = await request.text();
    if (!verifyStripeSignature(rawBody, request.headers.get("stripe-signature"), secret)) {
        return NextResponse.json({ error: "Assinatura inválida" }, { status: 400 });
    }

    try {
        await handleStripeEvent(JSON.parse(rawBody));
        return NextResponse.json({ received: true });
    } catch (error) {
        console.error("[stripe] erro ao processar evento:", error);
        // 500 faz a Stripe tentar de novo mais tarde
        return NextResponse.json({ error: "Erro ao processar" }, { status: 500 });
    }
}
