import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { ownerIdOfSession } from "@/lib/plans";
import { quotaMidiaBytes } from "@/lib/media-retention";
import { mediaStorage } from "@/lib/media-storage";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** POST /api/uploads — recebe uma imagem (multipart, campo "file") e devolve a URL interna. */
export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    try {
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return NextResponse.json({ status: false, message: "Envie uma imagem." }, { status: 400 });
        if (!TYPES.has(file.type)) return NextResponse.json({ status: false, message: "Use uma imagem JPG, PNG ou WebP." }, { status: 400 });
        if (file.size > MAX_BYTES) return NextResponse.json({ status: false, message: "A imagem pode ter no máximo 5 MB." }, { status: 400 });

        // Imagem enviada dentro de uma sessão pertence ao dono da sessão (assim o cliente também a vê, mesmo se o admin subiu)
        let ownerId = user.id;
        const sessionId = form.get("sessionId");
        if (typeof sessionId === "string" && sessionId) {
            if (!(await canAccessSession(user.id, user.role, sessionId))) return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
            ownerId = (await ownerIdOfSession(sessionId)) || user.id;
        }

        // Quota por dono: o arquivo fica no banco, então o total precisa de teto (imagens antigas são limpas pela retenção)
        const quota = quotaMidiaBytes();
        if (quota > 0) {
            const usado = (await prisma.mediaFile.aggregate({ where: { userId: ownerId }, _sum: { size: true } }))._sum.size ?? 0;
            if (usado + file.size > quota) {
                return NextResponse.json({ status: false, message: "Limite de armazenamento de imagens atingido. Apague imagens antigas e tente de novo." }, { status: 413 });
            }
        }

        const row = await mediaStorage.save({ userId: ownerId, name: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()) });
        return NextResponse.json({ status: true, data: { url: `/api/uploads/${row.id}`, type: "image", name: file.name } });
    } catch (e) {
        console.error("Upload error", e);
        return NextResponse.json({ status: false, message: "Falha ao enviar a imagem." }, { status: 500 });
    }
}
