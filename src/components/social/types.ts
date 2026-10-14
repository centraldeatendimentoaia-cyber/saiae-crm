import moment from "moment-timezone";

export const TZ = "America/Sao_Paulo";

export type Provider = "instagram" | "facebook";
export type PostType = "FEED" | "STORY";
export type PostStatus = "DRAFT" | "PENDING" | "PAUSED" | "PUBLISHING" | "PUBLISHED" | "FAILED";

export interface Account {
    id: string;
    provider: Provider;
    externalId: string;
    name: string;
    username: string | null;
    picture: string | null;
    nickname: string | null;
    color: string | null;
    postingTimes: string[];
}

export interface PostAccount {
    id: string;
    provider: Provider;
    name: string;
    username: string | null;
    nickname: string | null;
    color: string | null;
}

export interface Post {
    id: string;
    accountId: string;
    type: PostType;
    caption: string | null;
    mediaIds: string[];
    publishAt: string | null;
    groupId: string | null;
    seriesId: string | null;
    status: PostStatus;
    releaseUrl: string | null;
    error: string | null;
    publishedAt: string | null;
    account: PostAccount | null;
}

export interface SeriesVariant {
    caption: string;
    mediaIds: string[];
}

export interface Series {
    id: string;
    name: string;
    accountIds: string[];
    type: PostType;
    weekdays: number[];
    time: string;
    startDate: string;
    endDate: string | null;
    maxCount: number | null;
    variants: SeriesVariant[];
    status: "ACTIVE" | "PAUSED" | "ENDED";
    generatedCount: number;
    rule: string;
    stats: { scheduled: number; published: number; failed: number };
    nextAt: string | null;
}

export interface Signature {
    id: string;
    name: string;
    content: string;
}

export const STATUS_INFO: Record<PostStatus, { label: string; dot: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    DRAFT: { label: "Rascunho", dot: "bg-slate-400", variant: "outline" },
    PENDING: { label: "Agendada", dot: "bg-blue-500", variant: "secondary" },
    PAUSED: { label: "Série pausada", dot: "bg-slate-400", variant: "outline" },
    PUBLISHING: { label: "Publicando…", dot: "bg-amber-500", variant: "outline" },
    PUBLISHED: { label: "Publicada", dot: "bg-green-500", variant: "default" },
    FAILED: { label: "Falhou", dot: "bg-red-500", variant: "destructive" },
};

const FALLBACK_COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#0ea5e9", "#a855f7", "#ef4444", "#14b8a6"];

/** Cor da conta no calendário: a escolhida ou uma estável derivada do id. */
export function accountColor(a: { id: string; color: string | null } | null | undefined): string {
    if (!a) return "#94a3b8";
    if (a.color) return a.color;
    let h = 0;
    for (const c of a.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

export const providerLabel = (p: string) => (p === "instagram" ? "Instagram" : "Facebook");

export const accountName = (a: { nickname: string | null; username: string | null; name: string }) =>
    a.nickname || (a.username ? "@" + a.username : a.name);

export const accountLabel = (a: { provider: string; nickname: string | null; username: string | null; name: string }) =>
    `${providerLabel(a.provider)} · ${accountName(a)}`;

export const postTypeLabel = (p: { type: PostType; mediaIds: string[] }) =>
    p.type === "STORY" ? "Story" : p.mediaIds.length > 1 ? `Carrossel (${p.mediaIds.length})` : "Feed";

/** Valor para <input type="datetime-local"> em horário de Brasília. */
export const toInputValue = (m: moment.Moment) => m.clone().tz(TZ).format("YYYY-MM-DDTHH:mm");
export const fromInputValue = (v: string) => moment.tz(v, "YYYY-MM-DDTHH:mm", TZ);

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DAYS_LONG = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
export const DAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "terça-feira, 21 de outubro" — sem depender do idioma global do moment. */
export const longDay = (m: moment.Moment) => `${DAYS_LONG[m.day()]}, ${m.date()} de ${MONTHS[m.month()]}`;
/** "outubro de 2026" */
export const monthYear = (m: moment.Moment) => `${MONTHS[m.month()]} de ${m.year()}`;
/** "21 out" */
export const shortDate = (m: moment.Moment) => `${m.format("DD/MM")}`;

export const mediaSrc =(id: string) => `/api/uploads/${id}`;

/** fetch JSON da API do CRM; lança Error com a mensagem do servidor. */
export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.status === false) throw new Error(json.message || "Algo deu errado");
    return json as T;
}

export const jsonInit = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
});
