import { prisma } from "@/lib/prisma";
import { UPLOAD_PREFIX } from "@/lib/media";

const LOTE = 200;

/** Quota de mídia por dono (MB). 0 desliga. Cada arquivo já é limitado a 5 MB em /api/uploads. */
export function quotaMidiaBytes(): number {
    const n = parseInt(process.env.MEDIA_QUOTA_MB || "", 10);
    return (Number.isFinite(n) && n >= 0 ? n : 200) * 1024 * 1024;
}

/** IDs de MediaFile ainda usados por algo que vai acontecer (postagem/série ativa, disparo, resposta automática, story). */
async function idsEmUso(candidatos: string[]): Promise<Set<string>> {
    const emUso = new Set<string>();
    const marca = (texto: string | null | undefined) => {
        if (!texto) return;
        for (const id of candidatos) if (texto.includes(id)) emUso.add(id);
    };
    const porUrl = { OR: candidatos.map((id) => ({ mediaUrl: { contains: `${UPLOAD_PREFIX}${id}` } })) };

    const [msgs, auto, stories, posts, series] = await Promise.all([
        prisma.scheduledMessage.findMany({ where: porUrl, select: { mediaUrl: true } }),
        prisma.autoReply.findMany({ where: porUrl, select: { mediaUrl: true } }),
        prisma.story.findMany({ where: porUrl, select: { mediaUrl: true } }),
        prisma.scheduledPost.findMany({ where: { status: { in: ["DRAFT", "PENDING", "PAUSED", "PUBLISHING"] } }, select: { mediaIds: true } }),
        prisma.postSeries.findMany({ where: { status: { in: ["ACTIVE", "PAUSED"] } }, select: { variants: true } }),
    ]);
    [...msgs, ...auto, ...stories].forEach((r) => marca(r.mediaUrl));
    posts.forEach((p) => marca(JSON.stringify(p.mediaIds)));
    series.forEach((s) => marca(JSON.stringify(s.variants)));
    return emUso;
}

/**
 * Apaga mídia enviada pelo painel (MediaFile.data fica no banco e engorda o backup) com mais de `dias` dias
 * que nada pendente referencia. Postagens já publicadas perdem só a miniatura no histórico. Devolve quantas apagou.
 */
export async function limparMidiasAntigas(dias: number): Promise<number> {
    if (dias <= 0) return 0;
    const corte = new Date(Date.now() - dias * 86_400_000);
    let total = 0;
    const jaVistos: string[] = [];
    for (;;) {
        const lote = await prisma.mediaFile.findMany({
            where: { createdAt: { lt: corte }, ...(jaVistos.length ? { id: { notIn: jaVistos } } : {}) },
            select: { id: true },
            orderBy: { createdAt: "asc" },
            take: LOTE,
        });
        if (lote.length === 0) break;
        const ids = lote.map((m) => m.id);
        const emUso = await idsEmUso(ids);
        const apagar = ids.filter((id) => !emUso.has(id));
        if (apagar.length) total += (await prisma.mediaFile.deleteMany({ where: { id: { in: apagar } } })).count;
        jaVistos.push(...ids.filter((id) => emUso.has(id)));
        if (lote.length < LOTE) break;
    }
    return total;
}
