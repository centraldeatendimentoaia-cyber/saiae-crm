import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { parsePostInput } from "@/modules/social/validate";

/** GET /api/social/posts?tab=pending|history */
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const history = new URL(request.url).searchParams.get("tab") === "history";
    const posts = await prisma.scheduledPost.findMany({
        where: { userId: user.id, status: history ? { in: ["PUBLISHED", "FAILED"] } : { in: ["PENDING", "PUBLISHING"] } },
        orderBy: { publishAt: history ? "desc" : "asc" },
        take: 200,
    });
    const accounts = await prisma.socialAccount.findMany({ where: { userId: user.id }, select: { id: true, provider: true, name: true, username: true } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return NextResponse.json({ status: true, data: posts.map((p) => ({ ...p, account: byId.get(p.accountId) ?? null })) });
}

/** POST /api/social/posts { accountId, type, caption, mediaIds[], publishAt } */
export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const account = await prisma.socialAccount.findFirst({ where: { id: String(body?.accountId || ""), userId: user.id }, select: { id: true, provider: true } });
    if (!account) return NextResponse.json({ status: false, message: "Conta não encontrada." }, { status: 404 });

    const parsed = parsePostInput(body, account.provider === "instagram" ? "instagram" : "facebook");
    if ("error" in parsed) return NextResponse.json({ status: false, message: parsed.error }, { status: 400 });
    const input = parsed.value;

    const medias = await prisma.mediaFile.findMany({ where: { id: { in: input.mediaIds }, userId: user.id }, select: { id: true, publicToken: true } });
    if (medias.length !== input.mediaIds.length) return NextResponse.json({ status: false, message: "Imagem não encontrada." }, { status: 400 });

    // só mídia que entra numa postagem ganha URL pública
    for (const m of medias) {
        if (!m.publicToken) await prisma.mediaFile.update({ where: { id: m.id }, data: { publicToken: randomBytes(24).toString("hex") } });
    }

    const post = await prisma.scheduledPost.create({
        data: { userId: user.id, accountId: account.id, type: input.type, caption: input.caption || null, mediaIds: input.mediaIds, publishAt: input.publishAt },
    });
    return NextResponse.json({ status: true, data: post });
}
