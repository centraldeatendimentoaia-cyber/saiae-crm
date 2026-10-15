import { NextRequest, NextResponse } from "next/server";
import { lerObjetoOpcional } from "@/lib/validate";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { isHexColor, parsePostingTimes } from "@/modules/social/validate";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/social/accounts/:id { nickname?, color?, postingTimes? } */
export async function PATCH(request: NextRequest, { params }: Ctx) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const lido = await lerObjetoOpcional(request);
    if (!lido.ok) return lido.response;
    const body = lido.data;

    const data: Record<string, string | null> = {};
    if ("nickname" in body) {
        const n = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 60) : "";
        data.nickname = n || null;
    }
    if ("color" in body) {
        if (body.color !== null && !isHexColor(body.color)) return NextResponse.json({ status: false, message: "Cor inválida (use #RRGGBB)." }, { status: 400 });
        data.color = body.color;
    }
    if ("postingTimes" in body) {
        const t = parsePostingTimes(body.postingTimes);
        if ("error" in t) return NextResponse.json({ status: false, message: t.error }, { status: 400 });
        data.postingTimes = JSON.stringify(t.value);
    }
    if (!Object.keys(data).length) return NextResponse.json({ status: false, message: "Nada para alterar." }, { status: 400 });

    const r = await prisma.socialAccount.updateMany({ where: { id, userId: user.id }, data });
    if (r.count !== 1) return NextResponse.json({ status: false, message: "Not found" }, { status: 404 });
    return NextResponse.json({ status: true });
}

/** DELETE /api/social/accounts/:id — desconecta a conta e cancela as postagens pendentes dela. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const acc = await prisma.socialAccount.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!acc) return NextResponse.json({ status: false, message: "Not found" }, { status: 404 });
    await prisma.scheduledPost.updateMany({
        where: { accountId: id, status: { in: ["PENDING", "DRAFT"] } },
        data: { status: "FAILED", error: "Conta desconectada antes da publicação." },
    });
    await prisma.socialAccount.delete({ where: { id } });
    return NextResponse.json({ status: true });
}
