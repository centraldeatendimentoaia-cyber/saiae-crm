import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { encryptToken } from "@/modules/social/crypto";
import { discoverAccounts, pagesWithoutInstagram } from "@/modules/social/graph";
import { accountPublicSelect, parseTimes } from "@/modules/social/posts";

async function listAccounts(userId: string) {
    const rows = await prisma.socialAccount.findMany({ where: { userId }, select: accountPublicSelect, orderBy: { createdAt: "asc" } });
    return rows.map(({ postingTimes, ...a }) => ({ ...a, postingTimes: parseTimes(postingTimes) }));
}

/** GET /api/social/accounts — contas conectadas (sem o token). */
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ status: true, data: await listAccounts(user.id) });
}

/**
 * POST /api/social/accounts { userToken } — cola um token de usuário da Meta (idealmente de longa duração);
 * o sistema descobre as Páginas e os Instagrams Business ligados e guarda o token de cada Página (criptografado).
 */
export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const userToken = typeof body.userToken === "string" ? body.userToken.trim() : "";
    if (userToken.length < 20) return NextResponse.json({ status: false, message: "Cole o token de acesso da Meta." }, { status: 400 });

    try {
        const found = await discoverAccounts(userToken);
        if (!found.length) {
            return NextResponse.json({ status: false, message: "Nenhuma Página encontrada para esse token. Confira as permissões (pages_show_list) e se você escolheu as Páginas ao gerar o token." }, { status: 400 });
        }
        for (const a of found) {
            const data = { name: a.name, username: a.username ?? null, picture: a.picture ?? null, pageId: a.pageId, accessToken: encryptToken(a.accessToken) };
            await prisma.socialAccount.upsert({
                where: { userId_provider_externalId: { userId: user.id, provider: a.provider, externalId: a.externalId } },
                create: { userId: user.id, provider: a.provider, externalId: a.externalId, ...data },
                update: data,
            });
        }
        const semIg = pagesWithoutInstagram(found);
        const aviso = semIg.length
            ? ` Sem Instagram ligado: ${semIg.join(", ")}. Confira se o Instagram é Business/Creator, está ligado a essa Página e foi marcado ao gerar o token.`
            : "";
        return NextResponse.json({ status: true, message: `${found.length} conta(s) conectada(s).${aviso}`, warning: semIg, data: await listAccounts(user.id) });
    } catch (e) {
        return NextResponse.json({ status: false, message: e instanceof Error ? e.message : "Falha ao falar com a Meta." }, { status: 400 });
    }
}
