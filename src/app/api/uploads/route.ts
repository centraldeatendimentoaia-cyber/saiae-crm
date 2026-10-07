import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";

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

        const row = await prisma.mediaFile.create({
            data: { userId: user.id, name: file.name.slice(0, 200), mime: file.type, size: file.size, data: Buffer.from(await file.arrayBuffer()) },
            select: { id: true },
        });
        return NextResponse.json({ status: true, data: { url: `/api/uploads/${row.id}`, type: "image", name: file.name } });
    } catch (e) {
        console.error("Upload error", e);
        return NextResponse.json({ status: false, message: "Falha ao enviar a imagem." }, { status: 500 });
    }
}
