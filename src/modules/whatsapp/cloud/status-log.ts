import type { NormalizedBatch, StatusUpdate } from "./inbound";

/**
 * Linha de log SEGURA para status de entrega "failed" da Cloud API, para diagnosticar por que uma
 * mensagem não chegou. Só: tipo, status, código do erro da Meta, título curto e categoria.
 * NUNCA telefone, texto, ids de usuário, id de mensagem nem token.
 */

const MAX_TITLE = 80;

/** Título do erro da Meta, defensivo: corta o tamanho e esconde qualquer sequência longa de dígitos. */
export function safeTitle(title: string | null): string {
    if (!title) return "-";
    const clean = title.replace(/\d{6,}/g, "#").replace(/[\r\n\t]+/g, " ").trim();
    return clean ? clean.slice(0, MAX_TITLE) : "-";
}

/** Categoria: só letras, números e _ (ex.: utility, marketing, service). */
function safeCategory(category: string | null | undefined): string {
    return category && /^[a-z0-9_]{1,40}$/i.test(category) ? category : "-";
}

/** Uma linha por status "failed" do lote. Lote sem falhas: lista vazia. */
export function failedStatusLines(batch: NormalizedBatch): string[] {
    return batch.events
        .filter((e): e is StatusUpdate => e.kind === "status" && e.status === "failed")
        .map((e) => {
            const code = e.error?.code ?? "-";
            return `tipo=status status=failed codigo=${code} titulo="${safeTitle(e.error?.title ?? null)}" categoria=${safeCategory(e.billing?.category)}`;
        });
}
