import { logger } from "@/lib/logger";
import type { NormalizedBatch } from "./inbound";

/**
 * Gancho por onde os eventos normalizados da Cloud API entram no resto do sistema.
 *
 * Hoje NÃO há consumidor: o padrão é não fazer nada (não responde, não persiste, não loga conteúdo).
 * Quando existirem consumidores (WindowStore da janela de 24 h, IA, avisos), eles se registram aqui.
 * Um consumidor que falha nunca derruba os outros nem faz o webhook responder erro à Meta (a Meta
 * reentregaria o mesmo lote).
 */
export type InboundConsumer = (batch: NormalizedBatch) => Promise<void> | void;

const consumers: InboundConsumer[] = [];

/** Registra um consumidor. Devolve a função que o remove (útil em testes). */
export function registerInboundConsumer(consumer: InboundConsumer): () => void {
    consumers.push(consumer);
    return () => {
        const i = consumers.indexOf(consumer);
        if (i >= 0) consumers.splice(i, 1);
    };
}

/** Entrega o lote a todos os consumidores, isolando falhas. O log de erro não inclui o conteúdo do lote. */
export async function dispatchInbound(batch: NormalizedBatch): Promise<void> {
    if (batch.events.length === 0) return;
    await Promise.all(
        [...consumers].map(async (consumer) => {
            try {
                await consumer(batch);
            } catch (e) {
                logger.error("WhatsAppInbound", `consumidor falhou: ${e instanceof Error ? e.name : "erro"}`);
            }
        })
    );
}
