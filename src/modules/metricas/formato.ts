import { diaSaoPaulo } from "@/modules/atendimento-comum/tempo";

/** Formatação e contas da tela de métricas (puras, para testar sem navegador). */

/** 45 → "45 s"; 300 → "5 min"; 7800 → "2 h 10 min"; 100000 → "1 d 3 h". null → "—". */
export function formatarDuracao(segundos: number | null | undefined): string {
    if (segundos === null || segundos === undefined || !Number.isFinite(segundos)) return "—";
    const s = Math.max(0, Math.round(segundos));
    if (s < 60) return `${s} s`;
    const min = Math.round(s / 60);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
    const d = Math.floor(h / 24);
    return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** Percentual inteiro de `parte` em `total`; null quando não há base de comparação. */
export function percentual(parte: number, total: number): number | null {
    return total > 0 ? Math.round((parte / total) * 100) : null;
}

export interface Variacao {
    /** atual - anterior */
    diferenca: number;
    /** variação relativa em %, ou null quando o anterior é zero/ausente */
    percentual: number | null;
    sentido: "subiu" | "caiu" | "igual";
}

export function variacao(atual: number | null, anterior: number | null): Variacao | null {
    if (atual === null || anterior === null) return null;
    const diferenca = atual - anterior;
    return {
        diferenca,
        percentual: anterior !== 0 ? Math.round((diferenca / anterior) * 100) : null,
        sentido: diferenca > 0 ? "subiu" : diferenca < 0 ? "caiu" : "igual",
    };
}

/** Últimos `dias` dias terminando em `hoje` (inclusive), no fuso de São Paulo. */
export function ultimosDias(dias: number, hoje: Date = new Date()): { de: string; ate: string } {
    const ate = diaSaoPaulo(hoje);
    return { de: somarDias(ate, -(dias - 1)), ate };
}

/** Soma dias a uma data AAAA-MM-DD (calendário, sem fuso). */
export function somarDias(dia: string, n: number): string {
    const d = new Date(`${dia}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

/** "2026-10-12" → "12/10/2026" */
export function dataBr(dia: string): string {
    const [a, m, d] = dia.split("-");
    return `${d}/${m}/${a}`;
}

/** Período anterior de mesmo tamanho, colado antes de `de`. */
export function periodoAnterior(de: string, ate: string): { de: string; ate: string } {
    const dias = Math.round((new Date(`${ate}T12:00:00Z`).getTime() - new Date(`${de}T12:00:00Z`).getTime()) / 86_400_000) + 1;
    return { de: somarDias(de, -dias), ate: somarDias(de, -1) };
}
