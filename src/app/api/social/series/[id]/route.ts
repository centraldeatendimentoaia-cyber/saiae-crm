import { NextRequest, NextResponse } from "next/server";
import { lerObjetoOpcional } from "@/lib/validate";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { asProvider, ensurePublicTokens } from "@/modules/social/posts";
import { generateForSeries, parseVariants, Variant } from "@/modules/social/series";

type Ctx = { params: Promise<{ id: string }> };
const FUTURE = ["PENDING", "PAUSED"];

/**
 * PATCH /api/social/series/:id
 *  { status: "PAUSED" | "ACTIVE" | "ENDED" }  pausa, retoma ou encerra
 *  { name?, variants?, applyToFuture? }       edita; applyToFuture reescreve as postagens futuras ainda não enviadas
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const lido = await lerObjetoOpcional(request);
    if (!lido.ok) return lido.response;
    const body = lido.data;

    const series = await prisma.postSeries.findFirst({ where: { id, userId: user.id } });
    if (!series) return NextResponse.json({ status: false, message: "Not found" }, { status: 404 });
    const now = new Date();

    if (body.status !== undefined) {
        if (series.status === "ENDED") return NextResponse.json({ status: false, message: "Esta série já terminou." }, { status: 409 });

        if (body.status === "PAUSED") {
            await prisma.postSeries.update({ where: { id }, data: { status: "PAUSED" } });
            await prisma.scheduledPost.updateMany({ where: { seriesId: id, status: "PENDING", publishAt: { gt: now } }, data: { status: "PAUSED" } });
            return NextResponse.json({ status: true, message: "Série pausada: as próximas postagens ficam em espera." });
        }
        if (body.status === "ACTIVE") {
            await prisma.postSeries.update({ where: { id }, data: { status: "ACTIVE" } });
            // o que ficou para trás durante a pausa não sai atrasado
            await prisma.scheduledPost.deleteMany({ where: { seriesId: id, status: "PAUSED", publishAt: { lte: now } } });
            await prisma.scheduledPost.updateMany({ where: { seriesId: id, status: "PAUSED" }, data: { status: "PENDING" } });
            const fresh = await prisma.postSeries.findUnique({ where: { id } });
            if (fresh) await generateForSeries(fresh, now);
            return NextResponse.json({ status: true, message: "Série retomada." });
        }
        if (body.status === "ENDED") {
            await prisma.postSeries.update({ where: { id }, data: { status: "ENDED" } });
            const r = await prisma.scheduledPost.deleteMany({ where: { seriesId: id, status: { in: FUTURE } } });
            return NextResponse.json({ status: true, message: `Série encerrada. ${r.count} postagem(ns) futura(s) removida(s).` });
        }
        return NextResponse.json({ status: false, message: "Status inválido." }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (typeof body.name === "string") {
        const name = body.name.trim().slice(0, 80);
        if (!name) return NextResponse.json({ status: false, message: "Dê um nome para a série." }, { status: 400 });
        data.name = name;
    }

    let variants: Variant[] | null = null;
    if (body.variants !== undefined) {
        const accs = await prisma.socialAccount.findMany({ where: { id: { in: series.accountIds as string[] }, userId: user.id }, select: { provider: true } });
        const parsed = parseVariants(body.variants, series.type as "FEED" | "STORY", accs.map((a) => asProvider(a.provider)));
        if ("error" in parsed) return NextResponse.json({ status: false, message: parsed.error }, { status: 400 });
        const mediaIds = [...new Set(parsed.value.flatMap((v) => v.mediaIds))];
        if (!(await ensurePublicTokens(user.id, mediaIds))) return NextResponse.json({ status: false, message: "Imagem não encontrada." }, { status: 400 });
        variants = parsed.value;
        data.variants = variants;
    }
    if (!Object.keys(data).length) return NextResponse.json({ status: false, message: "Nada para alterar." }, { status: 400 });

    await prisma.postSeries.update({ where: { id }, data: data as never });

    let rewritten = 0;
    if (variants && body.applyToFuture) {
        const future = await prisma.scheduledPost.findMany({ where: { seriesId: id, status: { in: FUTURE }, publishAt: { gt: now } }, select: { seriesIndex: true }, distinct: ["seriesIndex"] });
        for (const f of future) {
            if (f.seriesIndex === null) continue;
            const v = variants[f.seriesIndex % variants.length];
            const r = await prisma.scheduledPost.updateMany({
                where: { seriesId: id, seriesIndex: f.seriesIndex, status: { in: FUTURE }, publishAt: { gt: now } },
                data: { caption: v.caption || null, mediaIds: v.mediaIds },
            });
            rewritten += r.count;
        }
    }
    return NextResponse.json({ status: true, message: variants && body.applyToFuture ? `Série atualizada (${rewritten} postagem(ns) futuras reescritas).` : "Série atualizada.", data: { rewritten } });
}

/** DELETE /api/social/series/:id — apaga a série e as postagens futuras dela; as já publicadas ficam no histórico. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const series = await prisma.postSeries.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!series) return NextResponse.json({ status: false, message: "Not found" }, { status: 404 });

    const r = await prisma.scheduledPost.deleteMany({ where: { seriesId: id, status: { in: FUTURE } } });
    // as já enviadas perdem o vínculo (a série deixa de existir)
    await prisma.scheduledPost.updateMany({ where: { seriesId: id }, data: { seriesId: null, groupId: null } });
    await prisma.postSeries.delete({ where: { id } });
    return NextResponse.json({ status: true, data: { removed: r.count } });
}
