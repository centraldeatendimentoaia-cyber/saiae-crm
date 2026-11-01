import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { TreinoSchema, type Treino } from "./treino";

const TAG = "Atendente";

const ehUnicaViolada = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";

/** Grava o rascunho depois de validar; nada inválido chega ao banco. */
export async function salvarRascunho(sessionId: string, t: Treino): Promise<void> {
    const rascunho = TreinoSchema.parse(t);
    await prisma.atendenteTreino.upsert({
        where: { sessionId },
        create: { sessionId, rascunho },
        update: { rascunho },
    });
}

/**
 * Publica o rascunho como a próxima versão da sessão (máximo + 1) e devolve o número. Se duas publicações correrem juntas
 * e a restrição única (sessionId, versao) barrar uma, tenta mais uma vez; na segunda falha o erro sobe.
 */
export async function publicar(sessionId: string): Promise<number> {
    for (let tentativa = 0; ; tentativa++) {
        try {
            return await prisma.$transaction(async (tx) => {
                const treino = await tx.atendenteTreino.findUnique({ where: { sessionId } });
                if (!treino) throw new Error("Não há rascunho para publicar nesta sessão.");
                const conteudo = TreinoSchema.parse(treino.rascunho);
                const { _max } = await tx.atendenteVersao.aggregate({ where: { sessionId }, _max: { versao: true } });
                const versao = (_max.versao ?? 0) + 1;
                await tx.atendenteVersao.create({ data: { sessionId, versao, conteudo } });
                await tx.atendenteTreino.update({ where: { sessionId }, data: { publicadoVersao: versao } });
                return versao;
            });
        } catch (e) {
            if (tentativa === 0 && ehUnicaViolada(e)) continue;
            throw e;
        }
    }
}

/** Volta para uma versão já publicada: copia o conteúdo dela para o rascunho e a marca como publicada (não cria versão nova). */
export async function reverter(sessionId: string, versao: number): Promise<void> {
    await prisma.$transaction(async (tx) => {
        const v = await tx.atendenteVersao.findUnique({ where: { sessionId_versao: { sessionId, versao } } });
        if (!v) throw new Error(`A versão ${versao} não existe nesta sessão.`);
        const conteudo = TreinoSchema.parse(v.conteudo);
        await tx.atendenteTreino.upsert({
            where: { sessionId },
            create: { sessionId, rascunho: conteudo, publicadoVersao: versao },
            update: { rascunho: conteudo, publicadoVersao: versao },
        });
    });
}

/** Treino da versão publicada, ou null se não há publicação ou o JSON gravado não passa no schema (nunca derruba quem chama). */
export async function carregarPublicado(sessionId: string): Promise<Treino | null> {
    const treino = await prisma.atendenteTreino.findUnique({ where: { sessionId } });
    if (!treino || treino.publicadoVersao == null) return null;
    const v = await prisma.atendenteVersao.findUnique({
        where: { sessionId_versao: { sessionId, versao: treino.publicadoVersao } },
    });
    if (!v) return null;
    const r = TreinoSchema.safeParse(v.conteudo);
    if (!r.success) {
        logger.warn(TAG, `treino publicado (versão ${treino.publicadoVersao}) inválido na sessão ${sessionId}; ignorado`);
        return null;
    }
    return r.data;
}
