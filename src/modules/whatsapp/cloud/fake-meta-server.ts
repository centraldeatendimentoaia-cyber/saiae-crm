import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Servidor HTTP falso da Graph API da Meta, só para testes. Escuta em 127.0.0.1 (porta efêmera),
 * registra cada requisição e responde com sucesso, a menos que o teste enfileire outra resposta.
 * Nunca fala com a Meta de verdade.
 */

export interface RecordedRequest {
    method: string;
    path: string;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
    /** Corpo já interpretado, quando é JSON. */
    json: Record<string, unknown> | null;
}

export interface QueuedResponse {
    status: number;
    body: unknown;
    delayMs?: number;
}

export class FakeMetaServer {
    readonly requests: RecordedRequest[] = [];
    private queue: QueuedResponse[] = [];
    private server: http.Server;
    private counter = 0;
    baseUrl = "";

    constructor() {
        this.server = http.createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => {
                const body = Buffer.concat(chunks);
                let json: Record<string, unknown> | null = null;
                if ((req.headers["content-type"] ?? "").includes("application/json")) {
                    try {
                        json = JSON.parse(body.toString("utf8"));
                    } catch {
                        json = null;
                    }
                }
                this.requests.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers, body, json });

                const queued = this.queue.shift();
                const reply = (status: number, payload: unknown) => {
                    res.writeHead(status, { "Content-Type": "application/json" });
                    res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
                };
                const respond = () => {
                    if (queued) return reply(queued.status, queued.body);
                    this.counter += 1;
                    if ((req.url ?? "").endsWith("/media")) return reply(200, { id: `MEDIA${this.counter}` });
                    return reply(200, {
                        messaging_product: "whatsapp",
                        contacts: [{ input: "x", wa_id: "x" }],
                        messages: [{ id: `wamid.FAKE${this.counter}` }],
                    });
                };
                if (queued?.delayMs) setTimeout(respond, queued.delayMs);
                else respond();
            });
        });
    }

    async start(): Promise<void> {
        await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
        this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    }

    /** Próxima resposta fora do padrão (uma por chamada, em ordem). */
    enqueue(r: QueuedResponse): void {
        this.queue.push(r);
    }

    reset(): void {
        this.requests.length = 0;
        this.queue = [];
        this.counter = 0;
    }

    async stop(): Promise<void> {
        this.server.closeAllConnections?.();
        await new Promise<void>((resolve) => this.server.close(() => resolve()));
    }
}

/** Corpo de erro no formato da Graph API. */
export const metaError = (code: number, message: string, extra: { subcode?: number; details?: string; fbtrace_id?: string } = {}) => ({
    error: {
        message,
        type: "OAuthException",
        code,
        ...(extra.subcode ? { error_subcode: extra.subcode } : {}),
        ...(extra.details ? { error_data: { messaging_product: "whatsapp", details: extra.details } } : {}),
        fbtrace_id: extra.fbtrace_id ?? "AbCdEfGhIjK",
    },
});
