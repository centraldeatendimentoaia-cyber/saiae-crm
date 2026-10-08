/**
 * Estado EM MEMÓRIA para idempotência e ordem dos eventos.
 *
 * LIMITE IMPORTANTE: sem persistência, nada daqui sobrevive a reinício nem é compartilhado entre
 * instâncias. Depois de um restart (deploy, queda, limite de memória) um evento já entregue pode ser
 * entregue de novo, e a regra de `sequence` recomeça do zero. É "melhor esforço". Quando a idempotência
 * precisar ser garantida, guardar `id` e a última `sequence` por pedido numa tabela (exige schema).
 */

export class BoundedTtlMap<V> {
    private readonly map = new Map<string, { value: V; expiresAt: number }>();

    constructor(private readonly maxSize: number, private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

    get(key: string): V | undefined {
        const hit = this.map.get(key);
        if (!hit) return undefined;
        if (hit.expiresAt <= this.now()) {
            this.map.delete(key);
            return undefined;
        }
        return hit.value;
    }

    has(key: string): boolean {
        return this.get(key) !== undefined;
    }

    set(key: string, value: V): void {
        this.map.delete(key); // reinsere no fim (o mais antigo é o primeiro)
        this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
        while (this.map.size > this.maxSize) {
            const oldest = this.map.keys().next().value;
            if (oldest === undefined) break;
            this.map.delete(oldest);
        }
    }

    clear(): void {
        this.map.clear();
    }

    get size(): number {
        return this.map.size;
    }
}

const MAX_ENTRIES = 10_000;
const TTL_MS = 24 * 60 * 60 * 1000;

interface EventState {
    seenIds: BoundedTtlMap<true>;
    lastSequence: BoundedTtlMap<number>;
}

// globalThis: sobrevive ao recarregamento de módulos em desenvolvimento.
const g = globalThis as unknown as { __comandaEventState?: EventState };
const state: EventState = (g.__comandaEventState ||= {
    seenIds: new BoundedTtlMap<true>(MAX_ENTRIES, TTL_MS),
    lastSequence: new BoundedTtlMap<number>(MAX_ENTRIES, TTL_MS),
});

export const wasSeen = (id: string) => state.seenIds.has(id);
export const markSeen = (id: string) => state.seenIds.set(id, true);

/** Chave da ordem: por barraca e pedido. */
export const sequenceKey = (barracaId: string, pedidoId: string) => `${barracaId}:${pedidoId}`;

/** true se este evento é mais antigo que um já visto do mesmo pedido (deve ser ignorado). */
export function isStale(key: string, sequence: number): boolean {
    const last = state.lastSequence.get(key);
    return last !== undefined && sequence < last;
}

export function recordSequence(key: string, sequence: number): void {
    const last = state.lastSequence.get(key);
    state.lastSequence.set(key, last === undefined ? sequence : Math.max(last, sequence));
}

/** Só para testes. */
export function resetEventState(): void {
    state.seenIds.clear();
    state.lastSequence.clear();
}
