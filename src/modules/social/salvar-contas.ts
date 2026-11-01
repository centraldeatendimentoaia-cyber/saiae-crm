import { prisma } from "@/lib/prisma";
import { encryptToken } from "./crypto";
import { pagesWithoutInstagram, type DiscoveredAccount } from "./graph";

/** Guarda (ou atualiza) as contas descobertas, com o token da Página criptografado. Devolve os nomes das Páginas sem Instagram. */
export async function salvarContas(userId: string, found: DiscoveredAccount[]): Promise<string[]> {
    for (const a of found) {
        const data = { name: a.name, username: a.username ?? null, picture: a.picture ?? null, pageId: a.pageId, accessToken: encryptToken(a.accessToken) };
        await prisma.socialAccount.upsert({
            where: { userId_provider_externalId: { userId, provider: a.provider, externalId: a.externalId } },
            create: { userId, provider: a.provider, externalId: a.externalId, ...data },
            update: data,
        });
    }
    return pagesWithoutInstagram(found);
}
