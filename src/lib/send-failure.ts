import { CloudApiError } from "@/modules/whatsapp/cloud/errors";

/**
 * Classificação das falhas de envio de WhatsApp, para decidir se vale tentar de novo.
 *
 * - transient: nada indica que a mensagem saiu; vale retentar com espera crescente (ex.: limite de taxa da Meta).
 *   É também o padrão para erros comuns sem sinal de que a mensagem possa ter saído (comportamento anterior).
 * - permanent: tentar de novo não muda o resultado (número sem WhatsApp, pedido inválido, token inválido).
 * - policy: bloqueio de regra (descadastro, "só quem já interagiu", janela de 24 h fechada, template exigido).
 * - unknown: o envio pode ter acontecido (tempo esgotado, conexão caiu, resposta sem id). NUNCA reenviar sozinho:
 *   reenviar pode duplicar a mensagem para o cliente. Cloud API: sem id da mensagem não há como consultar o status;
 *   Baileys: não há confirmação posterior. O registro fica visível para conferência manual.
 */
export type FailureClass = "transient" | "permanent" | "policy" | "unknown";

const POLICY_RE = /Descadastrado|respondeu SAIR|Sem conversa anterior|só quem já interagiu|janela de atendimento|template/i;
const PERMANENT_RE = /não possui WhatsApp|número inválido|invalid (jid|number)/i;
const UNKNOWN_RE = /time(d)?[ -]?out|tempo esgotado|connection (closed|lost|terminated)|conex(ã|a)o (fechada|perdida|encerrada)|ECONNRESET|EPIPE|ETIMEDOUT|socket hang up|AbortError/i;

export function classifySendFailure(e: unknown): FailureClass {
    if (e instanceof CloudApiError) {
        switch (e.kind) {
            case "window_closed":
            case "template":
                return "policy";
            case "rate_limit":
                return "transient"; // a Meta recusou: nada foi enviado
            case "network":
            case "server":
            case "unexpected_response":
                return "unknown"; // a Meta pode ter aceitado a mensagem antes do erro
            default:
                return "permanent"; // auth, undeliverable, invalid_request, unsupported
        }
    }
    const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
    if (POLICY_RE.test(msg)) return "policy";
    if (PERMANENT_RE.test(msg)) return "permanent";
    if (UNKNOWN_RE.test(msg)) return "unknown";
    return "transient";
}

/** Espera antes da tentativa seguinte (1ª retentativa = índice 0). */
export const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000];
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
export const backoffMs = (attemptsDone: number) => BACKOFF_MS[Math.min(Math.max(attemptsDone, 1), BACKOFF_MS.length) - 1];
