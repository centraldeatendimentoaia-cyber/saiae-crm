export type PostType = "FEED" | "STORY";

export interface PostInput {
    accountId: string;
    type: PostType;
    caption: string;
    mediaIds: string[];
    publishAt: Date;
}

const MAX_CAPTION = { instagram: 2200, facebook: 63206 } as const;

/** Valida o corpo de POST /api/social/posts. Devolve a mensagem de erro (pt-BR) ou os dados limpos. */
export function parsePostInput(body: any, provider: "instagram" | "facebook", now = new Date()): { error: string } | { value: PostInput } {
    const type = body?.type;
    if (type !== "FEED" && type !== "STORY") return { error: "Tipo inválido (use FEED ou STORY)." };

    const mediaIds: string[] = Array.isArray(body?.mediaIds) ? body.mediaIds.filter((x: unknown) => typeof x === "string") : [];
    if (mediaIds.length < 1) return { error: "Escolha pelo menos uma imagem." };
    if (new Set(mediaIds).size !== mediaIds.length) return { error: "A mesma imagem foi escolhida duas vezes." };
    if (type === "STORY" && mediaIds.length !== 1) return { error: "Story aceita exatamente 1 imagem." };
    if (mediaIds.length > 10) return { error: "No máximo 10 imagens por postagem." };

    const caption = typeof body?.caption === "string" ? body.caption.trim() : "";
    if (type === "FEED" && caption.length > MAX_CAPTION[provider]) return { error: `Legenda grande demais (máx. ${MAX_CAPTION[provider]} caracteres).` };

    const publishAt = new Date(body?.publishAt);
    if (Number.isNaN(publishAt.getTime())) return { error: "Data de publicação inválida." };
    if (publishAt.getTime() < now.getTime() - 5 * 60_000) return { error: "A data de publicação já passou." };

    return { value: { accountId: String(body?.accountId || ""), type, caption: type === "STORY" ? "" : caption, mediaIds, publishAt } };
}
