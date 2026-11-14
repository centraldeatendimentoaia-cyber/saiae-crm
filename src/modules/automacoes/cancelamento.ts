import { prisma } from "@/lib/prisma";
import { STATUS_ATIVOS, type MotivoCancelamento } from "./tipos";

/** Cancelamento automático para ganchos externos (humano assumiu, opt-out): todas as execuções ativas do contato. Módulo à parte para não puxar a autenticação para quem só precisa cancelar. */
export async function cancelarRunsDoContato(sessionId: string, contactKey: string, motivo: MotivoCancelamento): Promise<number> {
    const r = await prisma.automationRun.updateMany({
        where: { sessionId, contactKey, status: { in: STATUS_ATIVOS } },
        data: { status: "cancelled", motivoFim: motivo, finishedAt: new Date(), resumeAt: null, claimedBy: null, claimExpiresAt: null },
    });
    return r.count;
}
