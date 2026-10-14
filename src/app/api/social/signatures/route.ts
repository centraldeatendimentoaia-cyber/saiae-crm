import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";

const MAX_SIGNATURES = 30;

/** GET /api/social/signatures — textos salvos para colar na legenda. */
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const data = await prisma.socialSignature.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    return NextResponse.json({ status: true, data });
}

/** POST /api/social/signatures { name, content } */
export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
    const content = typeof body.content === "string" ? body.content.trim().slice(0, 2000) : "";
    if (!name || !content) return NextResponse.json({ status: false, message: "Informe um nome e o texto." }, { status: 400 });
    if ((await prisma.socialSignature.count({ where: { userId: user.id } })) >= MAX_SIGNATURES) {
        return NextResponse.json({ status: false, message: `Limite de ${MAX_SIGNATURES} textos salvos.` }, { status: 400 });
    }
    const row = await prisma.socialSignature.create({ data: { userId: user.id, name, content } });
    return NextResponse.json({ status: true, data: row });
}
