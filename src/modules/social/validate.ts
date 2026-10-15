export type PostType = "FEED" | "STORY";
export type Provider = "instagram" | "facebook";

export const MAX_DATES = 60;
export const MAX_POSTS_PER_REQUEST = 120;
const MAX_CAPTION: Record<Provider, number> = { instagram: 2200, facebook: 63206 };
const GRACE_MS = 5 * 60_000; // "publicar agora" chega alguns segundos depois do clique

export interface NewPostInput {
    accountIds: string[];
    type: PostType;
    caption: string;
    mediaIds: string[];
    /** vazio quando é rascunho */
    dates: Date[];
    draft: boolean;
}

export interface MediaContentInput {
    type: PostType;
    caption: string;
    mediaIds: string[];
}

/** Corpo de requisição desconhecido como objeto simples; qualquer outra coisa vira {} (os campos são validados um a um). */
export function asRecord(body: unknown): Record<string, unknown> {
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** Valida tipo, imagens e legenda (compartilhado entre criar e editar). */
export function parseContent(body: unknown, providers: Provider[]): { error: string } | { value: MediaContentInput } {
    const b = asRecord(body);
    const type = b.type;
    if (type !== "FEED" && type !== "STORY") return { error: "Tipo inválido (use FEED ou STORY)." };

    const mediaIds: string[] = Array.isArray(b.mediaIds) ? b.mediaIds.filter((x): x is string => typeof x === "string") : [];
    if (mediaIds.length < 1) return { error: "Escolha pelo menos uma imagem." };
    if (new Set(mediaIds).size !== mediaIds.length) return { error: "A mesma imagem foi escolhida duas vezes." };
    if (type === "STORY" && mediaIds.length !== 1) return { error: "Story aceita exatamente 1 imagem." };
    if (mediaIds.length > 10) return { error: "No máximo 10 imagens por postagem." };

    const caption = typeof b.caption === "string" ? b.caption.trim() : "";
    const limit = Math.min(...providers.map((p) => MAX_CAPTION[p]));
    if (type === "FEED" && caption.length > limit) return { error: `Legenda grande demais (máx. ${limit} caracteres).` };

    return { value: { type, caption: type === "STORY" ? "" : caption, mediaIds } };
}

/** Uma data de publicação: válida e não mais que 5 min no passado. */
export function parseDate(value: unknown, now = new Date()): { error: string } | { value: Date } {
    const d = new Date(value as string);
    if (Number.isNaN(d.getTime())) return { error: "Data de publicação inválida." };
    if (d.getTime() < now.getTime() - GRACE_MS) return { error: "A data de publicação já passou." };
    return { value: d };
}

/**
 * Corpo de POST /api/social/posts. Aceita o formato antigo (accountId + publishAt) e o novo
 * (accountIds[] + dates[] ou draft: true).
 */
export function parseNewPost(body: unknown, providers: Provider[], now = new Date()): { error: string } | { value: NewPostInput } {
    const b = asRecord(body);
    const accountIds: string[] = Array.isArray(b.accountIds)
        ? b.accountIds.filter((x): x is string => typeof x === "string")
        : typeof b.accountId === "string" ? [b.accountId] : [];
    if (accountIds.length < 1) return { error: "Escolha pelo menos uma conta." };
    if (new Set(accountIds).size !== accountIds.length) return { error: "A mesma conta foi escolhida duas vezes." };

    const content = parseContent(body, providers);
    if ("error" in content) return content;

    const draft = b.draft === true;
    const rawDates: unknown[] = Array.isArray(b.dates) ? b.dates : b.publishAt ? [b.publishAt] : [];
    const dates: Date[] = [];

    if (!draft) {
        if (rawDates.length < 1) return { error: "Escolha pelo menos uma data de publicação." };
        if (rawDates.length > MAX_DATES) return { error: `No máximo ${MAX_DATES} datas por vez.` };
        for (const raw of rawDates) {
            const d = parseDate(raw, now);
            if ("error" in d) return d;
            dates.push(d.value);
        }
        if (new Set(dates.map((d) => d.getTime())).size !== dates.length) return { error: "Há datas repetidas na lista." };
        if (dates.length * accountIds.length > MAX_POSTS_PER_REQUEST) return { error: `Isso geraria mais de ${MAX_POSTS_PER_REQUEST} postagens de uma vez.` };
    }

    return { value: { accountIds, draft, dates, ...content.value } };
}

/** "09:00" → minutos desde 00:00; null se inválido. */
export function parseClock(v: unknown): number | null {
    const m = typeof v === "string" ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v) : null;
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Horários sugeridos da conta: lista ordenada, sem repetidos, até 8. */
export function parsePostingTimes(v: unknown): { error: string } | { value: string[] } {
    if (!Array.isArray(v)) return { error: "Horários inválidos." };
    const times = [...new Set(v.filter((x) => parseClock(x) !== null) as string[])].sort();
    if (times.length !== new Set(v).size) return { error: "Use horários no formato HH:MM." };
    if (times.length > 8) return { error: "No máximo 8 horários sugeridos." };
    return { value: times };
}

export const isHexColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
