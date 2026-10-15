"use client";



export interface WebhookLog {
    id: string;
    webhookId: string;
    event: string;
    status: string;
    requestUrl: string;
    requestHeaders?: unknown;
    requestBody?: unknown;
    responseStatusCode?: number;
    responseBody?: string;
    responseTimeMs?: number;
    errorMessage?: string;
    createdAt: string;
}

export function formatTime(ts: string, tz: string) {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts || "";
    try {
        return d.toLocaleString("pt-BR", { timeZone: tz });
    } catch {
        return d.toLocaleString("pt-BR");
    }
}

export function formatTimeOnly(ts: string, tz: string) {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    try {
        return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: tz });
    } catch {
        return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
}

export function formatJson(obj: unknown): string {
    try {
        return JSON.stringify(obj, null, 2);
    } catch {
        return String(obj);
    }
}
