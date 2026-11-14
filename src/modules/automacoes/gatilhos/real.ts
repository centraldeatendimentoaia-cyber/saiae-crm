import { prisma } from "@/lib/prisma";
import { ambienteReal } from "./catalogo";
import type { DepsRoteador, GatilhoDoFluxo } from "./roteador";

/**
 * Dependências reais do roteador (Prisma). Sem schema novo: o opt-out social usa a tabela `OptOut` existente com
 * sessionId `social:<accountId>` e phoneKey = id do remetente (NÃO o phoneKey de 8 dígitos do WhatsApp, que colidiria).
 */
const PROVEDOR: Record<string, string> = { instagram: "instagram", messenger: "facebook" };

// Cache em memória (TTL 48 h) só como otimização: a verdade é a tabela AutomationTriggerEvent (chave única), válida entre instâncias e reinícios.
const VISTOS = new Map<string, number>();
const TTL_MS = 48 * 3_600_000;
const visto = (chave: string) => { const t = VISTOS.get(chave); return t !== undefined && Date.now() - t <= TTL_MS; };
function lembrar(chave: string) {
    if (VISTOS.size > 5000) for (const [k, t] of VISTOS) if (Date.now() - t > TTL_MS) VISTOS.delete(k);
    VISTOS.set(chave, Date.now());
}

/** Reserva atômica: true só para quem criou a linha (P2002 = outra entrega/instância já reservou). Erro de banco propaga. */
export async function reservarNoBanco(chave: string): Promise<boolean> {
    if (visto(chave)) return false;
    try {
        await prisma.automationTriggerEvent.create({ data: { key: chave }, select: { id: true } });
    } catch (e) {
        if ((e as { code?: string } | null)?.code === "P2002") { lembrar(chave); return false; }
        throw e;
    }
    lembrar(chave);
    return true;
}

export function depsReais(): DepsRoteador {
    return {
        ambiente: ambienteReal(),
        agoraMs: () => Date.now(),
        async contasPorExterno(canal, externalId) {
            const rows = await prisma.socialAccount.findMany({ where: { provider: PROVEDOR[canal], externalId }, select: { id: true, userId: true } });
            return rows.map((r) => ({ accountId: r.id, userId: r.userId }));
        },
        async fluxosDaConta(userId, accountId) {
            const fluxos = await prisma.automationFlow.findMany({ where: { userId, status: "active", publishedVersionId: { not: null } }, select: { id: true, publishedVersionId: true }, take: 100 });
            const versoes = await prisma.automationFlowVersion.findMany({ where: { id: { in: fluxos.map((f) => f.publishedVersionId as string) } }, select: { id: true, definition: true } });
            const porId = new Map(versoes.map((v) => [v.id, v.definition as { trigger?: GatilhoDoFluxo } | null]));
            return fluxos.flatMap((f) => {
                const t = porId.get(f.publishedVersionId as string)?.trigger;
                return t && t.accountId === accountId ? [{ flowId: f.id, trigger: t }] : [];
            });
        },
        reservar: reservarNoBanco,
        async optedOut(accountId, remetenteId) {
            return !!(await prisma.optOut.findUnique({ where: { sessionId_phoneKey: { sessionId: `social:${accountId}`, phoneKey: remetenteId } }, select: { id: true } }));
        },
        async registrarOptOut(accountId, remetenteId) {
            const sessionId = `social:${accountId}`;
            await prisma.optOut.upsert({ where: { sessionId_phoneKey: { sessionId, phoneKey: remetenteId } }, create: { sessionId, phoneKey: remetenteId, jid: remetenteId }, update: {} });
        },
        // O executor só envia por WhatsApp. Sem provedor Instagram/Messenger não há como responder: recusa explicitamente.
        async iniciar() { return { ok: false, motivo: "canal_sem_provedor" }; },
    };
}
