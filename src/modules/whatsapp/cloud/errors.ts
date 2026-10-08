/** Erros do CloudApiProvider. Nenhum deles carrega o token de acesso. */

export type CloudErrorKind =
    | "window_closed" // fora da janela de 24 h: só template
    | "auth" // token inválido ou expirado
    | "rate_limit"
    | "undeliverable" // número sem WhatsApp ou inalcançável
    | "template" // template inexistente, não aprovado ou parâmetros errados
    | "invalid_request" // validação local ou erro 4xx não classificado
    | "unsupported" // recurso que o provedor ainda não faz (ex.: enviar para BSUID)
    | "network" // falha de rede ou tempo esgotado
    | "server" // 5xx da Meta
    | "unexpected_response";

export class CloudApiError extends Error {
    readonly kind: CloudErrorKind;
    readonly status: number | null;
    readonly code: number | null;
    readonly subcode: number | null;
    readonly details: string | null;
    readonly fbtraceId: string | null;
    /** Vale tentar de novo mais tarde sem mudar a mensagem. */
    readonly retryable: boolean;

    constructor(
        kind: CloudErrorKind,
        message: string,
        extra: { status?: number | null; code?: number | null; subcode?: number | null; details?: string | null; fbtraceId?: string | null; retryable?: boolean } = {}
    ) {
        super(message);
        this.name = "CloudApiError";
        this.kind = kind;
        this.status = extra.status ?? null;
        this.code = extra.code ?? null;
        this.subcode = extra.subcode ?? null;
        this.details = extra.details ?? null;
        this.fbtraceId = extra.fbtraceId ?? null;
        this.retryable = extra.retryable ?? (kind === "rate_limit" || kind === "network" || kind === "server");
    }
}

/** Texto livre ou mídia fora da janela de atendimento de 24 h. Nada foi enviado nem cobrado. */
export class WindowClosedError extends CloudApiError {
    readonly lastInboundAt: Date | null;
    readonly windowHours: number;

    constructor(lastInboundAt: Date | null, windowHours = 24) {
        super(
            "window_closed",
            lastInboundAt
                ? `Janela de atendimento de ${windowHours} h fechada (o cliente escreveu pela última vez em ${lastInboundAt.toISOString()}). Só é possível enviar um template aprovado.`
                : `Janela de atendimento de ${windowHours} h fechada (o cliente nunca escreveu para este número). Só é possível enviar um template aprovado.`,
            { retryable: false }
        );
        this.name = "WindowClosedError";
        this.lastInboundAt = lastInboundAt;
        this.windowHours = windowHours;
    }
}

/** Códigos conhecidos da Meta, agrupados. Fonte: lista de códigos de erro da Cloud API. */
export function classifyMetaError(status: number, code: number | null): CloudErrorKind {
    if (code === 131047) return "window_closed";
    if (code === 190 || status === 401) return "auth";
    if (code === 130429 || code === 131056 || code === 80007 || status === 429) return "rate_limit";
    if (code === 131026 || code === 131030) return "undeliverable";
    if (code !== null && code >= 132000 && code <= 132999) return "template";
    if (status >= 500) return "server";
    return "invalid_request";
}
