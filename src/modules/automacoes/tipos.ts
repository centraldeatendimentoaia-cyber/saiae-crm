/**
 * Motor de automações: tipos e limites. Formato JSON dos fluxos versionado por `schemaVersion`.
 * Desenho em docs/gestao-tecnica/sprint5-desenho.md.
 */

export const SCHEMA_VERSION = 1;

export type StatusRun = "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export const STATUS_FINAIS: StatusRun[] = ["completed", "failed", "cancelled"];
export const STATUS_ATIVOS: StatusRun[] = ["pending", "running", "waiting"];

export type MotivoCancelamento = "manual" | "humano_assumiu" | "optout" | "sessao_invalida";

// Limites de proteção (loop infinito, acúmulo de execuções, execução eterna).
export const MAX_PASSOS = 200; // nós executados por execução (inclui retentativas)
export const MAX_NOS = 100; // nós por fluxo
export const MAX_PROFUNDIDADE_EXPR = 8; // aninhamento de and/or/not
export const MAX_SIMULTANEAS_POR_CONTATO_FLUXO = 1;
export const TIMEOUT_TOTAL_MS = 7 * 24 * 3_600_000;
export const JANELA_DEDUP_MS = 3_600_000; // mesmo contato/fluxo/versão na mesma hora = mesma execução
export const CLAIM_TTL_MS = 5 * 60_000; // execução "running" sem renovar por mais que isto foi abandonada
export const ESPERA_MIN_MS = 1_000;
export const ESPERA_MAX_MS = TIMEOUT_TOTAL_MS; // uma espera maior que o prazo total da execução nunca seria cumprida
export const MAX_CLAIMS_SEM_PROGRESSO = 5; // reivindicações seguidas sem salvar nada = execução envenenada
export const PAUSA_HUMANO_MS = 12 * 3_600_000; // mesma pausa humana padrão da IA das lojas
export const MAX_TEXTO = 4096;

export type Valor = string | number | boolean | null;
export type Operando = Valor | { var: string };

/** Expressão estruturada (JSON), nunca texto executável. Operadores fixos. */
export type Expr =
    | { op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "startsWith"; a: Operando; b: Operando }
    | { op: "in"; a: Operando; b: Valor[] }
    | { op: "exists"; a: { var: string } }
    | { op: "and" | "or"; args: Expr[] }
    | { op: "not"; arg: Expr };

export type No =
    | { type: "texto"; text: string; next?: string }
    | { type: "template"; name: string; languageCode: string; params?: string[]; next?: string }
    | { type: "condicao"; expr: Expr; then: string; else: string }
    | { type: "espera"; ms: number; next?: string }
    | { type: "etiqueta"; nome: string; next?: string }
    | { type: "variavel"; nome: string; valor: string; next?: string }
    | { type: "transferencia_humana" }
    | { type: "fim" };

export interface Definicao {
    schemaVersion: number;
    start: string;
    nodes: Record<string, No>;
}

export const TIPOS_NO = ["texto", "template", "condicao", "espera", "etiqueta", "variavel", "transferencia_humana", "fim"] as const;

/** Destinos de saída de um nó (para o validador de grafo e para o executor). */
export function destinos(n: No): string[] {
    if (n.type === "condicao") return [n.then, n.else];
    if (n.type === "transferencia_humana" || n.type === "fim") return [];
    return n.next ? [n.next] : [];
}

export interface Contexto {
    vars: Record<string, Valor>;
    tentativas: Record<string, number>;
}
