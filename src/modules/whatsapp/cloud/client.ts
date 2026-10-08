import { CloudApiError, classifyMetaError } from "./errors";

export interface CloudApiConfig {
    /** phone_number_id do número da loja na Meta (não é o telefone). */
    phoneNumberId: string;
    /** Token de acesso do usuário do sistema. Segredo: nunca logar nem colocar em erro. */
    accessToken: string;
    /** Ex.: "v25.0". */
    apiVersion?: string;
    baseUrl?: string;
    /** Tempo máximo por chamada, em ms. */
    timeoutMs?: number;
    /** Injetável nos testes. */
    fetch?: typeof fetch;
}

export const DEFAULT_API_VERSION = "v25.0";
export const DEFAULT_BASE_URL = "https://graph.facebook.com";
export const DEFAULT_TIMEOUT_MS = 15_000;

interface MetaErrorBody {
    error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string; error_data?: { details?: string } };
}

/** Cliente HTTP mínimo da Graph API para as chamadas de envio. Sem estado e sem logs. */
export class CloudApiClient {
    private readonly base: string;
    private readonly timeoutMs: number;
    private readonly doFetch: typeof fetch;

    constructor(private readonly config: CloudApiConfig) {
        if (!config.phoneNumberId) throw new CloudApiError("invalid_request", "phoneNumberId é obrigatório");
        if (!config.accessToken) throw new CloudApiError("auth", "accessToken é obrigatório");
        this.base = `${(config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/${config.apiVersion ?? DEFAULT_API_VERSION}/${encodeURIComponent(config.phoneNumberId)}`;
        this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.doFetch = config.fetch ?? fetch;
    }

    /** POST /{phone_number_id}/messages. Devolve o id da mensagem (wamid). */
    async sendMessage(body: Record<string, unknown>): Promise<string> {
        const json = await this.request("/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
        });
        const messages = (json as { messages?: { id?: unknown }[] }).messages;
        const id = Array.isArray(messages) ? messages[0]?.id : undefined;
        if (typeof id !== "string" || !id) {
            throw new CloudApiError("unexpected_response", "A Meta respondeu sem o id da mensagem", { retryable: false });
        }
        return id;
    }

    /** POST /{phone_number_id}/media (multipart). Devolve o id da mídia hospedada na Meta. */
    async uploadMedia(data: Buffer, mimeType: string, fileName: string): Promise<string> {
        const form = new FormData();
        form.append("messaging_product", "whatsapp");
        form.append("type", mimeType);
        form.append("file", new Blob([new Uint8Array(data)], { type: mimeType }), fileName);
        const json = await this.request("/media", { method: "POST", body: form });
        const id = (json as { id?: unknown }).id;
        if (typeof id !== "string" || !id) {
            throw new CloudApiError("unexpected_response", "A Meta respondeu sem o id da mídia", { retryable: false });
        }
        return id;
    }

    private async request(path: string, init: { method: string; headers?: Record<string, string>; body: BodyInit }): Promise<unknown> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let res: Response;
        try {
            res = await this.doFetch(this.base + path, {
                method: init.method,
                headers: { ...init.headers, Authorization: `Bearer ${this.config.accessToken}` },
                body: init.body,
                signal: controller.signal,
            });
        } catch (e) {
            // Nunca repassa a mensagem/causa original: algumas bibliotecas incluem cabeçalhos na descrição do erro.
            const aborted = (e as { name?: string })?.name === "AbortError";
            throw new CloudApiError("network", aborted ? `Tempo esgotado (${this.timeoutMs} ms) falando com a Meta` : "Falha de rede falando com a Meta");
        } finally {
            clearTimeout(timer);
        }

        let payload: unknown = null;
        try {
            payload = await res.json();
        } catch {
            payload = null;
        }

        if (!res.ok) {
            const err = (payload as MetaErrorBody | null)?.error;
            const code = typeof err?.code === "number" ? err.code : null;
            const kind = classifyMetaError(res.status, code);
            throw new CloudApiError(kind, err?.message ? `Meta: ${err.message}` : `Meta respondeu HTTP ${res.status}`, {
                status: res.status,
                code,
                subcode: typeof err?.error_subcode === "number" ? err.error_subcode : null,
                details: err?.error_data?.details ?? null,
                fbtraceId: err?.fbtrace_id ?? null,
            });
        }
        if (payload === null || typeof payload !== "object") {
            throw new CloudApiError("unexpected_response", "A Meta respondeu com um corpo que não é JSON", { status: res.status, retryable: false });
        }
        return payload;
    }
}
