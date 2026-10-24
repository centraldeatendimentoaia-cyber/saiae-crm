import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { loadSecrets } from "@/modules/integracao/comanda/secrets";
import { segredosWhatsapp } from "@/modules/integracao/comanda/sessao-evento";
import { parseTimestamp, timestampInWindow, verifyComandaSignature } from "@/modules/integracao/comanda/signature";
import { validateEvento } from "@/modules/integracao/comanda/schema";
import { isStale, markSeen, recordSequence, sequenceKey, unmarkSeen, wasSeen } from "@/modules/integracao/comanda/state";
import { dispatchComandaEvent } from "@/modules/integracao/comanda/consumers";
import { registerOrderNotifier } from "@/modules/integracao/comanda/order-notifier";
import { registrarAvisoDoEvento } from "@/modules/integracao/comanda/aviso-registro";
import { acordarWorkerAvisos, iniciarWorkerAvisos } from "@/modules/integracao/comanda/aviso-worker";
import { agendarAvaliacaoDoEvento, iniciarWorkerAvaliacoes } from "@/modules/disparos/avaliacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;
const TAG = "ComandaEventos";

// Avisos de pedido por template (SAI-013). Só envia com COMANDA_NOTIFY_TEMPLATES=on; registrado uma vez.
registerOrderNotifier();
// Avisos pelo WhatsApp (Baileys) da própria barraca: o worker envia o que a rota registrou em banco.
iniciarWorkerAvisos();
iniciarWorkerAvaliacoes();

/**
 * Eventos Comanda → CRM (contrato SAI-001 v1, INTEGRACAO.md §2). Rota pública em src/proxy.ts (caminho
 * exato): a proteção é a assinatura HMAC por barraca + janela de 5 min.
 *
 * Ordem das checagens: não configurado (503) → tamanho (413) → cabeçalhos e JSON (401/400) → barraca e
 * assinatura (401) → schema (422) → idempotência e ordem → entrega aos consumidores → 200.
 *
 * Idempotência por `id` e ordem por `sequence` são EM MEMÓRIA, melhor esforço: não sobrevivem a
 * reinício (ver modules/integracao/comanda/state.ts). Nada é gravado e o log nunca traz telefone,
 * nome nem itens: só o tipo do evento e o resultado.
 */
export async function POST(request: NextRequest) {
    const secrets = loadSecrets();
    // Loja sem segredo próprio assina com o segredo de plataforma (o mesmo da conexão do WhatsApp): quem conecta o
    // WhatsApp não precisa configurar integração à parte. Segredo próprio, quando existe, é o único que vale.
    const plataforma = segredosWhatsapp();
    if (!secrets && plataforma.length === 0) {
        logger.error(TAG, "COMANDA_WEBHOOK_SECRETS e COMANDA_WHATSAPP_SEGREDO ausentes ou inválidos");
        return NextResponse.json({ error: "Integração não configurada" }, { status: 503 });
    }

    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
        return NextResponse.json({ error: "Corpo grande demais" }, { status: 413 });
    }
    const raw = Buffer.from(await request.arrayBuffer());
    if (raw.length > MAX_BODY_BYTES) {
        return NextResponse.json({ error: "Corpo grande demais" }, { status: 413 });
    }

    const unauthorized = (reason: string) => {
        logger.warn(TAG, `recusado: ${reason}`); // motivo fixo: nunca ecoa valores vindos do pedido
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    };

    const timestampHeader = request.headers.get("x-saiae-timestamp");
    const signatureHeader = request.headers.get("x-saiae-signature");
    const ts = parseTimestamp(timestampHeader);
    if (ts === null || !signatureHeader) return unauthorized("cabeçalhos de autenticação ausentes ou inválidos");

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw.toString("utf8"));
    } catch {
        return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }

    // O segredo é da barraca citada no corpo; só depois de a assinatura bater é que o corpo é confiável.
    const barracaId = typeof (parsed as { barraca_id?: unknown } | null)?.barraca_id === "string" ? (parsed as { barraca_id: string }).barraca_id : null;
    const barracaSecrets = barracaId ? (secrets?.get(barracaId) ?? (plataforma.length > 0 ? plataforma : undefined)) : undefined;
    if (!barracaSecrets) return unauthorized("barraca desconhecida");
    if (!timestampInWindow(ts)) return unauthorized("timestamp fora da janela de 5 minutos");
    if (!verifyComandaSignature(raw, timestampHeader!, signatureHeader, barracaSecrets)) return unauthorized("assinatura inválida");

    const result = validateEvento(parsed);
    if (!result.ok) {
        logger.warn(TAG, "evento fora do schema do contrato v1");
        return NextResponse.json({ error: "Evento fora do schema", details: result.errors }, { status: 422 });
    }
    const event = result.event;
    if (request.headers.get("x-saiae-event-id") !== event.id) {
        return NextResponse.json({ error: "X-Saiae-Event-Id diferente do id do corpo" }, { status: 422 });
    }

    // Idempotência: a Comanda reenvia até receber 2xx; duplicata responde 200 sem reprocessar.
    if (wasSeen(event.id)) {
        logger.info(TAG, `${event.type} duplicado`);
        return NextResponse.json({ received: true, duplicate: true });
    }

    // Ordem: evento mais antigo que um já visto do mesmo pedido é ignorado (200, para a Comanda não reenviar).
    const pedidoId = event.type.startsWith("order.") ? (event.data as { pedido_id?: unknown }).pedido_id : undefined;
    const seqKey = typeof pedidoId === "string" ? sequenceKey(event.barraca_id, pedidoId) : null;
    if (seqKey && isStale(seqKey, event.sequence)) {
        markSeen(event.id);
        logger.info(TAG, `${event.type} ignorado: sequence antiga`);
        return NextResponse.json({ received: true, ignored: "sequence_antiga" });
    }

    // Marca como visto ANTES de qualquer await: duas entregas simultâneas do mesmo id não passam as duas.
    markSeen(event.id);
    if (seqKey) recordSequence(seqKey, event.sequence);

    // Avisos pelo WhatsApp da barraca: grava como pendente ANTES do 2xx (o envio é do worker). Se o banco falhar, 503
    // e o evento deixa de contar como visto: a Comanda reenvia e o registro é refeito (a chave única impede duplicata).
    try {
        if ((await registrarAvisoDoEvento(event)) === "registrado") acordarWorkerAvisos();
        await agendarAvaliacaoDoEvento(event); // pedido de avaliação 30 min depois do "entregue" (idempotente)
    } catch {
        unmarkSeen(event.id);
        logger.error(TAG, "falha ao registrar o aviso do evento");
        return NextResponse.json({ error: "Falha temporária" }, { status: 503 });
    }
    logger.info(TAG, `${event.type} aceito`);

    // Sem esperar: a Comanda quer o 2xx rápido. Falha de consumidor nunca vira erro para ela.
    void dispatchComandaEvent(event).catch(() => {});
    return NextResponse.json({ received: true });
}
