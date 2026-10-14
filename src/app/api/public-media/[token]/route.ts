import { NextRequest } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/public-media/:token(.jpg) — imagem pública para a Meta baixar ao publicar.
 * O token é aleatório (48 hex) e só existe para mídia colocada numa postagem agendada.
 * Sempre devolve JPEG: o Instagram não aceita PNG/WebP pela API.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token: raw } = await params;
    const token = raw.replace(/\.jpe?g$/i, "");
    if (!/^[a-f0-9]{48}$/.test(token)) return new Response("Not found", { status: 404 });

    const row = await prisma.mediaFile.findFirst({ where: { publicToken: token }, select: { data: true, mime: true } });
    if (!row) return new Response("Not found", { status: 404 });

    const input = Buffer.from(row.data);
    const jpeg = row.mime === "image/jpeg" ? input : await sharp(input).flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
    return new Response(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" } });
}
