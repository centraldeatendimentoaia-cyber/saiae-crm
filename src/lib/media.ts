import { mediaStorage } from "@/lib/media-storage";

export const UPLOAD_PREFIX = "/api/uploads/";

/** Mídia enviada pelo painel vem do banco (Buffer); qualquer outra URL é baixada pelo WhatsApp. */
export async function resolveMedia(mediaUrl: string): Promise<Buffer | { url: string }> {
    if (mediaUrl.startsWith(UPLOAD_PREFIX)) {
        const row = await mediaStorage.load({ id: mediaUrl.slice(UPLOAD_PREFIX.length) });
        if (!row) throw new Error("Imagem não encontrada (foi removida?)");
        return row.data;
    }
    return { url: mediaUrl };
}
