import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { encryptToken } from "@/modules/social/crypto";
import { discoverAccounts } from "@/modules/social/graph";

const publicFields = { id: true, provider: true, externalId: true, pageId: true, name: true, username: true, picture: true, createdAt: true } as const;

/** GET /api/social/accounts — contas conectadas (sem o token). */
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    const data = await prisma.socialAccount.findMany({ where: { userId: user.id }, select: publicFields, orderBy: { createdAt: "asc" } });
    return NextResponse.json({ status: true, data });
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
        const data = await prisma.socialAccount.findMany({ where: { userId: user.id }, select: publicFields, orderBy: { createdAt: "asc" } });
        return NextResponse.json({ status: true, message: `${found.length} conta(s) conectada(s).`, data });
    } catch (e: any) {
        return NextResponse.json({ status: false, message: e?.message || "Falha ao falar com a Meta." }, { status: 400 });
    }
}
