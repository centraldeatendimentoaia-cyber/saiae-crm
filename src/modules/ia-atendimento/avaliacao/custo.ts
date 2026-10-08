import type { Llm, UsoLlm } from "../llm";

/**
 * Custo estimado de uma rodada da bateria. Preços em dólares por MILHÃO de tokens (tabela de modelos da Anthropic em
 * 2026-10): ESTIMATIVA, confira na página de preços. Escrita de cache = 1,25x a entrada (cache de 5 min); leitura de cache = 0,1x.
 * Modelo desconhecido: só tokens, sem custo.
 */

export interface PrecoModelo {
    entrada: number;
    saida: number;
}

export const PRECOS: Record<string, PrecoModelo> = {
    "claude-sonnet-5-5": { entrada: 2, saida: 10 },
    "claude-haiku-5-5": { entrada: 0.1, saida: 0.5 },
};

export const MULT_ESCRITA_CACHE = 1.25;
export const MULT_LEITURA_CACHE = 0.1;

export const usoVazio = (): UsoLlm => ({ entrada: 0, saida: 0, leituraCache: 0, criacaoCache: 0 });

export function somarUso(a: UsoLlm, b: UsoLlm | undefined): UsoLlm {
    if (!b) return a;
    return { entrada: a.entrada + b.entrada, saida: a.saida + b.saida, leituraCache: a.leituraCache + b.leituraCache, criacaoCache: a.criacaoCache + b.criacaoCache };
}

/** Custo em dólares, ou null se o modelo não está na tabela. */
export function custoEstimado(modelo: string, uso: UsoLlm): number | null {
    const p = PRECOS[modelo];
    if (!p) return null;
    const m = 1_000_000;
    return (uso.entrada * p.entrada + uso.criacaoCache * p.entrada * MULT_ESCRITA_CACHE + uso.leituraCache * p.entrada * MULT_LEITURA_CACHE + uso.saida * p.saida) / m;
}

/** Envolve um Llm somando o uso de todas as chamadas. */
export function medirUso(llm: Llm): { llm: Llm; total: () => UsoLlm; chamadas: () => number } {
    let total = usoVazio();
    let n = 0;
    return {
        llm: {
            async responder(entrada) {
                const saida = await llm.responder(entrada);
                total = somarUso(total, saida.uso);
                n++;
                return saida;
            },
        },
        total: () => total,
        chamadas: () => n,
    };
}

export function formatarUso(uso: UsoLlm, modelo: string, chamadas: number): string {
    const entradaTotal = uso.entrada + uso.leituraCache + uso.criacaoCache;
    const custo = custoEstimado(modelo, uso);
    return [
        `chamadas=${chamadas}`,
        `entrada=${entradaTotal} (nova=${uso.entrada} cache_leitura=${uso.leituraCache} cache_criacao=${uso.criacaoCache})`,
        `saida=${uso.saida}`,
        custo === null ? "custo=desconhecido (modelo fora da tabela)" : `custo_estimado=US$ ${custo.toFixed(4)}`,
    ].join(" | ");
}
