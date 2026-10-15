import { withJobLock, registrarInstancia, outrasInstanciasVivas } from "@/lib/job-lock";
import cron from "node-cron";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { decryptToken } from "./crypto";
import { GraphError, publishFacebook, publishInstagram, type PublishResult } from "./graph";
import { extendAllSeries } from "./series";

export const publicMediaUrl = (token: string) => `${(process.env.BASE_URL || "").replace(/\/$/, "")}/api/public-media/${token}.jpg`;

let running = false;

/** Publica um post vencido. O "claim" PENDING→PUBLISHING evita duas publicações do mesmo post. */
export async function publishOne(postId: string): Promise<void> {
    const claimed = await prisma.scheduledPost.updateMany({ where: { id: postId, status: "PENDING" }, data: { status: "PUBLISHING" } });
    if (claimed.count !== 1) return;

    const post = await prisma.scheduledPost.findUnique({ where: { id: postId } });
    if (!post) return;

    try {
        const account = await prisma.socialAccount.findUnique({ where: { id: post.accountId } });
        if (!account) throw new Error("Conta desconectada. Reconecte e agende de novo.");

        const ids = post.mediaIds as string[];
        const medias = await prisma.mediaFile.findMany({ where: { id: { in: ids } }, select: { id: true, publicToken: true } });
        const byId = new Map(medias.map((m) => [m.id, m.publicToken]));
        const imageUrls = ids.map((id) => {
            const t = byId.get(id);
            if (!t) throw new Error("Uma das imagens foi removida da biblioteca.");
            return publicMediaUrl(t);
        });

        const token = decryptToken(account.accessToken);
        const type = post.type === "STORY" ? "STORY" : "FEED";
        const result: PublishResult =
            account.provider === "instagram"
                ? await publishInstagram({ igId: account.externalId, token, type, imageUrls, caption: post.caption || undefined })
                : await publishFacebook({ pageId: account.pageId, token, type, imageUrls, caption: post.caption || undefined });

        await prisma.scheduledPost.update({
            where: { id: post.id },
            data: { status: "PUBLISHED", releaseId: result.id, releaseUrl: result.url ?? null, publishedAt: new Date(), error: null },
        });
        logger.info("Social", `Post ${post.id} publicado (${account.provider}/${type})`);
    } catch (err) {
        const message = String((err as Error)?.message || err).slice(0, 1000);
        logger.error("Social", `Post ${postId} falhou: ${message}`);
        await prisma.scheduledPost.update({ where: { id: postId }, data: { status: "FAILED", error: message } });
        const reconnect = err instanceof GraphError && err.needsReconnect;
        await prisma.notification
            .create({
                data: {
                    userId: post.userId,
                    title: reconnect ? "Reconecte sua conta social" : "Falha ao publicar postagem",
                    message: reconnect ? `A Meta recusou o token: ${message}` : message,
                    type: "WARNING",
                    href: "/dashboard/redes-sociais/historico",
                },
            })
            .catch(() => {});
    }
}

export async function publishDue(): Promise<void> {
    if (running) return;
    running = true;
    try {
        const due = await prisma.scheduledPost.findMany({
            where: { status: "PENDING", publishAt: { lte: new Date() } },
            orderBy: { publishAt: "asc" },
            take: 10,
            select: { id: true },
        });
        for (const p of due) await publishOne(p.id);
    } catch (err) {
        logger.error("Social", "Scheduler error:", err);
    } finally {
        running = false;
    }
}

export function startSocialScheduler() {
    // Se o servidor caiu no meio de uma publicação não dá para saber se a Meta aceitou:
    // marca como falha com aviso (re-publicar automaticamente poderia duplicar o post).
    // Com outra instância viva (deploy sobreposto) só mexe nas que travaram há mais de 15 min.
    outrasInstanciasVivas()
        .then((outras) => {
            registrarInstancia();
            const antigas = outras === 0 ? {} : { publishAt: { lt: new Date(Date.now() - 15 * 60_000) } };
            return prisma.scheduledPost.updateMany({
                where: { status: "PUBLISHING", ...antigas },
                data: { status: "FAILED", error: "Interrompido por reinício do servidor. Confira o perfil antes de publicar de novo (pode já ter saído)." },
            });
        })
        .catch(() => {});

    cron.schedule("* * * * *", () => void withJobLock("cron:social-publicar", 10 * 60_000, publishDue));

    // séries recorrentes: mantém as próximas 8 semanas geradas (na subida e a cada hora)
    void withJobLock("cron:social-series", 10 * 60_000, extendAllSeries);
    cron.schedule("7 * * * *", () => void withJobLock("cron:social-series", 10 * 60_000, extendAllSeries));
    logger.info("Social", "Social scheduler initialized");
}
