import { NextRequest, NextResponse } from "next/server";
import { lerObjetoOpcional } from "@/lib/validate";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { parseNewPost } from "@/modules/social/validate";
import { asProvider, ensurePublicTokens } from "@/modules/social/posts";

const STATUSES = ["DRAFT", "PENDING", "PAUSED", "PUBLISHING", "PUBLISHED", "FAILED"];

/**
 * GET /api/social/posts
 *   from, to      ISO — intervalo de publishAt (calendário)
 *   accountId     filtra por conta
 *   status        lista separada por vírgula (DRAFT,PENDING,...)
 *   tab           compatibilidade: pending | history
 *   limit         padrão 500, máx. 1000
 */
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const q = new URL(request.url).searchParams;
    const where: Record<string, unknown> = { userId: user.id };

    const from = q.get("from"), to = q.get("to");
    const range: Record<string, Date> = {};
    if (from && !Number.isNaN(new Date(from).getTime())) range.gte = new Date(from);
    if (to && !Number.isNaN(new Date(to).getTime())) range.lt = new Date(to);
    if (Object.keys(range).length) where.publishAt = range;
    if (q.get("accountId")) where.accountId = q.get("accountId");

    const status = (q.get("status") || "").split(",").filter((s) => STATUSES.includes(s));
    const tab = q.get("tab");
    if (status.length) where.status = { in: status };
    else if (tab === "history") where.status = { in: ["PUBLISHED", "FAILED"] };
    else if (tab === "pending") where.status = { in: ["PENDING", "PUBLISHING"] };

    const history = tab === "history" || (status.length > 0 && status.every((s) => s === "PUBLISHED" || s === "FAILED"));
    const limit = Math.min(Math.max(parseInt(q.get("limit") || "500", 10) || 500, 1), 1000);
    const posts = await prisma.scheduledPost.findMany({
        where,
        orderBy: history ? { publishAt: "desc" } : [{ publishAt: "asc" }, { createdAt: "desc" }],
        take: limit,
    });
    const accounts = await prisma.socialAccount.findMany({
        where: { userId: user.id },
        select: { id: true, provider: true, name: true, username: true, nickname: true, color: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return NextResponse.json({ status: true, data: posts.map((p) => ({ ...p, account: byId.get(p.accountId) ?? null })) });
}

/**
 * POST /api/social/posts
 * { accountIds[] | accountId, type, caption, mediaIds[], dates[] | publishAt, draft? }
 * Cria uma postagem por conta × data (rascunho: uma por conta, sem data). Todas ficam no mesmo groupId.
 */
export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const lido = await lerObjetoOpcional(request);
    if (!lido.ok) return lido.response;
    const body = lido.data;
    const wanted: string[] = Array.isArray(body?.accountIds) ? body.accountIds : typeof body?.accountId === "string" ? [body.accountId] : [];
    const accounts = await prisma.socialAccount.findMany({ where: { id: { in: wanted }, userId: user.id }, select: { id: true, provider: true } });
    if (!accounts.length || accounts.length !== new Set(wanted).size) {
        return NextResponse.json({ status: false, message: "Conta não encontrada." }, { status: 404 });
    }

    const parsed = parseNewPost(body, accounts.map((a) => asProvider(a.provider)));
    if ("error" in parsed) return NextResponse.json({ status: false, message: parsed.error }, { status: 400 });
    const input = parsed.value;

    if (!(await ensurePublicTokens(user.id, input.mediaIds))) {
        return NextResponse.json({ status: false, message: "Imagem não encontrada." }, { status: 400 });
    }

    const groupId = randomUUID();
    const slots: (Date | null)[] = input.draft ? [null] : input.dates;
    const rows = input.accountIds.flatMap((accountId) =>
        slots.map((publishAt) => ({
            userId: user.id,
            accountId,
            type: input.type,
            caption: input.caption || null,
            mediaIds: input.mediaIds,
            publishAt,
            groupId,
            status: input.draft ? "DRAFT" : "PENDING",
        }))
    );
    await prisma.scheduledPost.createMany({ data: rows });
    return NextResponse.json({
        status: true,
        message: `${rows.length} postagem(ns) ${input.draft ? "salva(s) como rascunho" : "agendada(s)"}.`,
        data: { count: rows.length, groupId },
    });
}
