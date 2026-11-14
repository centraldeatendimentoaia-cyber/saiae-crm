import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isOptedOut } from "@/lib/optout";
import { cloudSessionIds, getProvider } from "@/modules/whatsapp/provider";
import { numeroDeEnvioPertence } from "@/modules/whatsapp/provider/cloud-sessao";
import { dadosPausar } from "@/modules/atendimento-comum/pausa";
import type { Deps, RunRow, Store, StepRow, StatusPasso } from "./executor";
import type { Contexto, Definicao } from "./tipos";

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";
const json = (v: unknown) => v as Prisma.InputJsonValue;

const paraRun = (r: Awaited<ReturnType<typeof prisma.automationRun.findUniqueOrThrow>>): RunRow => ({
    id: r.id, userId: r.userId, sessionId: r.sessionId, contactKey: r.contactKey, flowVersionId: r.flowVersionId,
    status: r.status as RunRow["status"], currentNodeId: r.currentNodeId, context: r.context as unknown as Contexto,
    stepCount: r.stepCount, resumeAt: r.resumeAt, deadlineAt: r.deadlineAt,
});

export const prismaStore: Store = {
    // UPDATE condicional: o banco decide quem reivindica (count === 1). Duas instâncias nunca pegam a mesma execução.
    async claimRun(runId, holder, agora, ttlMs) {
        const r = await prisma.automationRun.updateMany({
            where: {
                id: runId,
                OR: [{ status: "pending" }, { status: "waiting", resumeAt: { lte: agora } }, { status: "running", claimExpiresAt: { lt: agora } }],
            },
            data: { status: "running", claimedBy: holder, claimExpiresAt: new Date(agora.getTime() + ttlMs) },
        });
        if (r.count !== 1) return null;
        return paraRun(await prisma.automationRun.findUniqueOrThrow({ where: { id: runId } }));
    },

    async salvar(runId, holder, patch, agora) {
        const { context, ...resto } = patch;
        const sai = patch.status !== undefined && patch.status !== "running"; // espera/fim: solta a reserva
        const r = await prisma.automationRun.updateMany({
            where: { id: runId, claimedBy: holder, status: "running" },
            data: { ...resto, ...(context ? { context: json(context) } : {}), ...(sai ? { claimedBy: null, claimExpiresAt: null } : { claimExpiresAt: new Date(agora.getTime() + 5 * 60_000) }) },
        });
        return r.count === 1;
    },

    async ultimoPasso(runId) {
        const p = await prisma.automationStep.findFirst({ where: { runId }, orderBy: { seq: "desc" } });
        return p ? { id: p.id, seq: p.seq, nodeId: p.nodeId, type: p.type, status: p.status as StatusPasso } : null;
    },

    async abrirPasso(runId, seq, nodeId, type, status) {
        try {
            const p = await prisma.automationStep.create({ data: { runId, seq, nodeId, type, status } });
            return { id: p.id, seq, nodeId, type, status } satisfies StepRow;
        } catch (e) {
            if (isUnique(e)) return null;
            throw e;
        }
    },

    async fecharPasso(stepId, patch) {
        await prisma.automationStep.update({
            where: { id: stepId },
            data: { status: patch.status, error: patch.error, failureClass: patch.failureClass, ...(patch.output !== undefined ? { output: json(patch.output) } : {}), finishedAt: new Date() },
        });
    },

    async definicao(flowVersionId) {
        const v = await prisma.automationFlowVersion.findUniqueOrThrow({ where: { id: flowVersionId }, select: { definition: true } });
        return v.definition as unknown as Definicao;
    },

    async listarProntas(agora, limite) {
        const rs = await prisma.automationRun.findMany({
            where: { OR: [{ status: "pending" }, { status: "waiting", resumeAt: { lte: agora } }, { status: "running", claimExpiresAt: { lt: agora } }] },
            select: { id: true },
            orderBy: { updatedAt: "asc" },
            take: limite,
        });
        return rs.map((r) => r.id);
    },
};

const HOLDER = randomUUID();
const H24 = 24 * 3_600_000;

/** Dependências reais: provedor existente (Cloud pela sessão correta), opt-out e conversa do atendimento. */
export const depsReais: Deps = {
    holder: HOLDER,
    agora: () => new Date(),
    optedOut: (sessionId, contactKey) => isOptedOut(sessionId, contactKey),
    conversa: async (sessionId, contactKey) =>
        prisma.agenteConversa.findUnique({ where: { sessionId_jid: { sessionId, jid: contactKey } }, select: { estado: true, pausadaAte: true } }),
    provider(sessionId) {
        // Sessão Cloud: o número de envio é um só; com várias sessões Cloud só envia se o número pertence a esta (cloud-sessao).
        if (cloudSessionIds().has(sessionId) && !numeroDeEnvioPertence(process.env, sessionId))
            return { ok: false, permanente: true, motivo: "número de envio da Cloud não pertence a esta sessão" };
        const provider = getProvider(sessionId);
        return provider ? { ok: true, provider } : { ok: false, permanente: false, motivo: "sessão indisponível para envio" };
    },
    async janelaAberta(sessionId, contactKey) {
        const s = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (!s) return false;
        const c = await prisma.contact.findFirst({ where: { sessionId: s.id, OR: [{ jid: contactKey }, { remoteJidAlt: contactKey }] }, select: { lastInboundAt: true } });
        return !!c?.lastInboundAt && Date.now() - c.lastInboundAt.getTime() < H24;
    },
    async etiquetar(sessionId, contactKey, nome) {
        const label = await prisma.label.upsert({ where: { sessionId_name: { sessionId, name: nome } }, create: { sessionId, name: nome }, update: {} });
        await prisma.chatLabel.upsert({ where: { labelId_chatJid: { labelId: label.id, chatJid: contactKey } }, create: { labelId: label.id, chatJid: contactKey }, update: {} });
    },
    async transferirHumano(sessionId, contactKey, ate) {
        const d = dadosPausar(ate, { motivoPausa: "automacao_transferencia" });
        await prisma.agenteConversa.upsert({ where: { sessionId_jid: { sessionId, jid: contactKey } }, create: { sessionId, jid: contactKey, ...d }, update: d });
    },
};
