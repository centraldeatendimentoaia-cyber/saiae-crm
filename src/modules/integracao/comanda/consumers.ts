import { logger } from "@/lib/logger";
import type { ComandaEvent } from "./schema";

/**
 * Consumidores dos eventos da Comanda (mesmo padrão de src/modules/whatsapp/cloud/inbound-handler.ts).
 * Hoje NÃO há consumidor. Um consumidor que falha nunca derruba os outros nem faz a rota responder erro
 * (a Comanda reenviaria o mesmo evento). O log de erro não inclui o conteúdo do evento.
 */
export type ComandaEventConsumer = (event: ComandaEvent) => Promise<void> | void;

const consumers: ComandaEventConsumer[] = [];

export function registerComandaEventConsumer(consumer: ComandaEventConsumer): () => void {
    consumers.push(consumer);
    return () => {
        const i = consumers.indexOf(consumer);
        if (i >= 0) consumers.splice(i, 1);
    };
}

export async function dispatchComandaEvent(event: ComandaEvent): Promise<void> {
    await Promise.all(
        [...consumers].map(async (consumer) => {
            try {
                await consumer(event);
            } catch (e) {
                logger.error("ComandaEventos", `consumidor falhou: ${e instanceof Error ? e.name : "erro"}`);
            }
        })
    );
}
