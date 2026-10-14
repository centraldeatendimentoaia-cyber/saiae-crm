import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { parseContent, parseDate } from "@/modules/social/validate";
import { asProvider, ensurePublicTokens } from "@/modules/social/posts";

const EDITABLE = ["DRAFT", "PENDING"];
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/social/posts/:id — inclui quantas postagens do mesmo grupo ainda dá para editar. */
export async function GET(request: NextRequest, { params }: Ctx) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const post = await prisma.scheduledPost.findFirst({ where: { id, userId: user.id } });
    if (!post) return NextResponse.json({ status: false, message: "Not found" }, { status: 404 });
    const groupEditable = post.groupId
        ? await prisma.scheduledPost.count({ where: { groupId: post.groupId, userId: user.id, status: { in: EDITABLE } } })
        : 1;
    return NextResponse.json({ status: true, data: { ...post, groupEditable } });
}

/**
 * PATCH /api/social/posts/:id — só rascunho e agendada (PUBLISHING/PUBLISHED/FAILED não mudam).
 * { type?, caption?, mediaIds?, publishAt?, draft?, applyToGroup? }
 *  - publishAt (ISO) reagenda; um rascunho com publishAt vira agendada; draft: true volta a rascunho (sem data).
 *  - applyToGroup copia tipo, legenda e imagens para as outras postagens editáveis do mesmo grupo.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const post = await prisma.scheduledPost.findFirst({ where: { id, userId: user.id } });
    if (!post) return NextResponse.json({ status: false, message: "Not found" }, { status: 404 });
    if (!EDITABLE.includes(post.status)) {
        return NextResponse.json({ status: false, message: "Esta postagem já foi enviada ou está sendo publicada e não pode mais ser alterada." }, { status: 409 });
    }

    const data: Record<string, unknown> = {};

    const contentChanged = ["type", "caption", "mediaIds"].some((k) => k in body);
    if (contentChanged) {
        const acc = await prisma.socialAccount.findFirst({ where: { id: post.accountId }, select: { provider: true } });
        const providers = [asProvider(acc?.provider || "facebook")];
        if (body.applyToGroup && post.groupId) {
            const others = await prisma.scheduledPost.findMany({ where: { groupId: post.groupId, userId: user.id, status: { in: EDITABLE } }, select: { accountId: true } });
            const accs = await prisma.socialAccount.findMany({ where: { id: { in: others.map((o) => o.accountId) } }, select: { provider: true } });
            providers.push(...accs.map((a) => asProvider(a.provider)));
        }
        const content = parseContent(
            { type: body.type ?? post.type, caption: body.caption ?? post.caption ?? "", mediaIds: body.mediaIds ?? post.mediaIds },
            providers
        );
        if ("error" in content) return NextResponse.json({ status: false, message: content.error }, { status: 400 });
        if (!(await ensurePublicTokens(user.id, content.value.mediaIds))) {
            return NextResponse.json({ status: false, message: "Imagem não encontrada." }, { status: 400 });
        }
        data.type = content.value.type;
        data.caption = content.value.caption || null;
        data.mediaIds = content.value.mediaIds;
    }

    if (body.draft === true) {
        data.publishAt = null;
        data.status = "DRAFT";
    } else if (body.publishAt !== undefined) {
        const d = parseDate(body.publishAt);
        if ("error" in d) return NextResponse.json({ status: false, message: d.error }, { status: 400 });
        data.publishAt = d.value;
        data.status = "PENDING";
    }

    if (!Object.keys(data).length) return NextResponse.json({ status: false, message: "Nada para alterar." }, { status: 400 });

    // o status no filtro garante que, se o agendador pegou o post agora, a edição não o sobrescreve
    const r = await prisma.scheduledPost.updateMany({ where: { id, userId: user.id, status: { in: EDITABLE } }, data: data as never });
    if (r.count !== 1) return NextResponse.json({ status: false, message: "A postagem mudou enquanto você editava. Atualize a tela." }, { status: 409 });

    if (body.applyToGroup && post.groupId && contentChanged) {
        await prisma.scheduledPost.updateMany({
            where: { groupId: post.groupId, userId: user.id, status: { in: EDITABLE }, id: { not: id } },
            data: { type: data.type as string, caption: data.caption as string | null, mediaIds: data.mediaIds as string[] },
        });
    }
    return NextResponse.json({ status: true });
}

/** DELETE /api/social/posts/:id — remove; com ?group=1 remove também as outras ainda não enviadas do mesmo grupo. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    const post = await prisma.scheduledPost.findFirst({ where: { id, userId: user.id }, select: { groupId: true } });
    if (!post) return NextResponse.json({ status: false, message: "Not found" }, { status: 404 });

    // PUBLISHING não pode sumir: a Meta pode estar aceitando o post agora
    const r = await prisma.scheduledPost.deleteMany({ where: { id, userId: user.id, status: { not: "PUBLISHING" } } });
    if (r.count !== 1) return NextResponse.json({ status: false, message: "Publicando agora, não dá para remover." }, { status: 409 });

    let removed = 1;
    if (new URL(request.url).searchParams.get("group") === "1" && post.groupId) {
        const g = await prisma.scheduledPost.deleteMany({ where: { groupId: post.groupId, userId: user.id, status: { in: EDITABLE } } });
        removed += g.count;
    }
    return NextResponse.json({ status: true, data: { removed } });
}
