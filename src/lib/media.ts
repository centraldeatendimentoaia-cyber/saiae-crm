import { prisma } from "@/lib/prisma";

export const UPLOAD_PREFIX = "/api/uploads/";

/** Mídia enviada pelo painel vem do banco (Buffer); qualquer outra URL é baixada pelo WhatsApp. */
export async function resolveMedia(mediaUrl: string): Promise<Buffer | { url: string }> {
    if (mediaUrl.startsWith(UPLOAD_PREFIX)) {
        const row = await prisma.mediaFile.findUnique({ where: { id: mediaUrl.slice(UPLOAD_PREFIX.length) }, select: { data: true } });
        if (!row) throw new Error("Imagem não encontrada (foi removida?)");
        return Buffer.from(row.data);
    }
    return { url: mediaUrl };
}
