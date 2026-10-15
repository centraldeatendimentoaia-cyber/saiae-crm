import { NextRequest, NextResponse } from "next/server";
import { lerObjetoOpcional } from "@/lib/validate";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { asProvider, ensurePublicTokens } from "@/modules/social/posts";
import { describeRule, generateForSeries, parseSeries, Variant } from "@/modules/social/series";

/** GET /api/social/series — séries com andamento (geradas, publicadas, próxima data). */
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const series = await prisma.postSeries.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    if (!series.length) return NextResponse.json({ status: true, data: [] });

    const ids = series.map((s) => s.id);
    const counts = await prisma.scheduledPost.groupBy({ by: ["seriesId", "status"], where: { userId: user.id, seriesId: { in: ids } }, _count: { _all: true } });
    const next = await prisma.scheduledPost.groupBy({ by: ["seriesId"], where: { userId: user.id, seriesId: { in: ids }, status: { in: ["PENDING", "PAUSED"] }, publishAt: { gt: new Date() } }, _min: { publishAt: true } });

    const data = series.map((s) => {
        const mine = counts.filter((c) => c.seriesId === s.id);
        const n = (st: string) => mine.find((c) => c.status === st)?._count._all ?? 0;
        return {
            ...s,
            rule: describeRule({ weekdays: s.weekdays as number[], time: s.time }),
            stats: { scheduled: n("PENDING") + n("PAUSED"), published: n("PUBLISHED"), failed: n("FAILED") },
            nextAt: next.find((x) => x.seriesId === s.id)?._min.publishAt ?? null,
        };
    });
    return NextResponse.json({ status: true, data });
}

/** POST /api/social/series — cria a série e já gera as próximas semanas. */
export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const lido = await lerObjetoOpcional(request);
    if (!lido.ok) return lido.response;
    const body = lido.data;
    const wanted: string[] = Array.isArray(body?.accountIds) ? body.accountIds : [];
    const accounts = await prisma.socialAccount.findMany({ where: { id: { in: wanted }, userId: user.id }, select: { id: true, provider: true } });
    if (!accounts.length || accounts.length !== new Set(wanted).size) return NextResponse.json({ status: false, message: "Conta não encontrada." }, { status: 404 });

    const parsed = parseSeries(body, accounts.map((a) => asProvider(a.provider)));
    if ("error" in parsed) return NextResponse.json({ status: false, message: parsed.error }, { status: 400 });
    const input = parsed.value;

    const mediaIds = [...new Set(input.variants.flatMap((v: Variant) => v.mediaIds))];
    if (!(await ensurePublicTokens(user.id, mediaIds))) return NextResponse.json({ status: false, message: "Imagem não encontrada." }, { status: 400 });

    const series = await prisma.postSeries.create({
        data: {
            userId: user.id, name: input.name, accountIds: input.accountIds, type: input.type, weekdays: input.weekdays, time: input.time,
            startDate: input.startDate, endDate: input.endDate, maxCount: input.maxCount, variants: input.variants,
            generatedThrough: new Date(), // nada antes de agora é gerado
        },
    });
    const created = await generateForSeries(series);
    if (!created) {
        return NextResponse.json({ status: true, message: "Série criada, mas nenhuma data cai nos próximos dias. Ela gera sozinha quando chegar a hora.", data: series });
    }
    return NextResponse.json({ status: true, message: `Série criada: ${created} postagem(ns) agendada(s) nas próximas semanas.`, data: series });
}
