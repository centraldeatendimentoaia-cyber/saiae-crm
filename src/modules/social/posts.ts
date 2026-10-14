import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import type { Provider } from "./validate";

/**
 * Confere que todas as imagens são do usuário e dá URL pública (token aleatório) às que ainda não têm.
 * Devolve false se alguma imagem não existe ou é de outro usuário.
 */
export async function ensurePublicTokens(userId: string, mediaIds: string[]): Promise<boolean> {
    const medias = await prisma.mediaFile.findMany({ where: { id: { in: mediaIds }, userId }, select: { id: true, publicToken: true } });
    if (medias.length !== new Set(mediaIds).size) return false;
    for (const m of medias) {
        if (!m.publicToken) await prisma.mediaFile.update({ where: { id: m.id }, data: { publicToken: randomBytes(24).toString("hex") } });
    }
    return true;
}

export const asProvider = (p: string): Provider => (p === "instagram" ? "instagram" : "facebook");

/** Campos da conta que a tela pode ver (nunca o token). */
export const accountPublicSelect = {
    id: true, provider: true, externalId: true, pageId: true, name: true, username: true, picture: true,
    nickname: true, color: true, postingTimes: true, createdAt: true,
} as const;

export function parseTimes(raw: string | null): string[] {
    try {
        const v = JSON.parse(raw || "[]");
        return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch {
        return [];
    }
}
