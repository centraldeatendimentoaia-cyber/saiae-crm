import { prisma } from "@/lib/prisma";
import { ambienteReal } from "./catalogo";
import type { DepsRoteador, GatilhoDoFluxo } from "./roteador";

/**
 * Dependências reais do roteador (Prisma). Sem schema novo: o opt-out social usa a tabela `OptOut` existente com
 * sessionId `social:<accountId>` e phoneKey = id do remetente (NÃO o phoneKey de 8 dígitos do WhatsApp, que colidiria).
 */
const PROVEDOR: Record<string, string> = { instagram: "instagram", messenger: "facebook" };

// shortcut: dedupe de eventos em memória do processo (TTL 48 h); com mais de uma instância precisa de tabela única (ver pendências de schema no relatório).
const VISTOS = new Map<string, number>();
const TTL_MS = 48 * 3_600_000;
export function reservarEmMemoria(chave: string, agora = Date.now()): boolean {
    if (VISTOS.size > 5000) for (const [k, t] of VISTOS) if (agora - t > TTL_MS) VISTOS.delete(k);
    const t = VISTOS.get(chave);
    if (t !== undefined && agora - t <= TTL_MS) return false;
    VISTOS.set(chave, agora);
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
        reservar: async (chave) => reservarEmMemoria(chave),
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
