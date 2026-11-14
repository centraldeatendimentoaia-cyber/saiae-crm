import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canAccessSession } from "@/lib/api-auth";
import { JANELA_DEDUP_MS, MAX_SIMULTANEAS_POR_CONTATO_FLUXO, SCHEMA_VERSION, STATUS_ATIVOS, TIMEOUT_TOTAL_MS, type Contexto, type Definicao, type MotivoCancelamento } from "./tipos";
import { validarDefinicao } from "./validador";
export { cancelarRunsDoContato } from "./cancelamento";

/** Serviço do motor: tudo escopado por `userId`. Sem gatilho real de webhook/Meta neste sprint (só início manual). */

export class ErroAutomacao extends Error {
    constructor(public codigo: "nao_encontrado" | "definicao_invalida" | "sem_versao_publicada" | "arquivado" | "sessao_invalida" | "contato_desconhecido", public detalhes: string[] = []) {
        super(`${codigo}${detalhes.length ? `: ${detalhes.join("; ")}` : ""}`);
        this.name = "ErroAutomacao";
    }
}

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";
const json = (v: unknown) => v as Prisma.InputJsonValue;

const limiteDeEnv = (nome: string, padrao: number) => { const n = Number(process.env[nome]); return Number.isFinite(n) && n > 0 ? n : padrao; };
/** Início manual em massa: teto por hora por usuário e por fluxo (env, padrão conservador). */
const limitePorUsuarioHora = () => limiteDeEnv("AUTOMACOES_MAX_INICIOS_HORA_USUARIO", 60);
const limitePorFluxoHora = () => limiteDeEnv("AUTOMACOES_MAX_INICIOS_HORA_FLUXO", 30);

/** O cliente pode mandar o id interno (cuid) ou o nome da sessão; o fluxo grava sempre o NOME (Session.sessionId), como o executor espera. */
async function resolverSessao(ref: string): Promise<string> {
    const s = (await prisma.session.findFirst({ where: { id: ref }, select: { sessionId: true } })) ?? (await prisma.session.findFirst({ where: { sessionId: ref }, select: { sessionId: true } }));
    if (!s) throw new ErroAutomacao("sessao_invalida");
    return s.sessionId;
}

export async function criarFluxo(i: { userId: string; sessionId: string; name: string; draft?: unknown }) {
    const sessionId = await resolverSessao(i.sessionId);
    return prisma.automationFlow.create({ data: { userId: i.userId, sessionId, name: i.name, draft: json(i.draft ?? { schemaVersion: SCHEMA_VERSION, start: "", nodes: {} }) } });
}

export async function atualizarRascunho(userId: string, flowId: string, draft: unknown) {
    const r = await prisma.automationFlow.updateMany({ where: { id: flowId, userId, status: "active" }, data: { draft: json(draft) } });
    if (r.count !== 1) throw new ErroAutomacao("nao_encontrado");
}

/** Publica o rascunho como nova versão IMUTÁVEL, só se o validador de grafo aprovar. */
export async function publicarFluxo(userId: string, flowId: string) {
    const flow = await prisma.automationFlow.findFirst({ where: { id: flowId, userId } });
    if (!flow) throw new ErroAutomacao("nao_encontrado");
    if (flow.status !== "active") throw new ErroAutomacao("arquivado");
    const erros = validarDefinicao(flow.draft);
    if (erros.length) throw new ErroAutomacao("definicao_invalida", erros);
    for (let tentativa = 0; ; tentativa++) {
        try {
            // Versão e ponteiro na mesma transação: nunca sobra versão criada sem o fluxo apontar para ela.
            return await prisma.$transaction(async (tx) => {
                const ultima = await tx.automationFlowVersion.findFirst({ where: { flowId }, orderBy: { version: "desc" }, select: { version: true } });
                const v = await tx.automationFlowVersion.create({
                    data: { flowId, version: (ultima?.version ?? 0) + 1, schemaVersion: SCHEMA_VERSION, definition: json(flow.draft) },
                });
                await tx.automationFlow.update({ where: { id: flowId }, data: { publishedVersionId: v.id } });
                return v;
            });
        } catch (e) {
            if (!isUnique(e) || tentativa >= 2) throw e; // publicação simultânea pegou o mesmo número: tenta o próximo
        }
    }
}

export type ResultadoInicio =
    | { ok: true; runId: string }
    | { ok: false; motivo: "duplicada" | "limite_simultaneas" | "limite_taxa"; runId?: string };

/**
 * Inicia uma execução (gatilho manual/interno). Deduplicação: (versão, contato, dedupeKey) é único; sem `dedupeKey`
 * vale a janela de 1 h. Limite de execuções ativas por contato e fluxo (checagem antes de gravar: não é atômica entre
 * chaves diferentes, ver riscos no relatório).
 */
export async function iniciarRun(i: { userId: string; role: string; flowId: string; contactKey: string; dedupeKey?: string; agora?: Date }): Promise<ResultadoInicio> {
    const agora = i.agora ?? new Date();
    const flow = await prisma.automationFlow.findFirst({ where: { id: i.flowId, userId: i.userId } });
    if (!flow) throw new ErroAutomacao("nao_encontrado");
    if (flow.status !== "active") throw new ErroAutomacao("arquivado");
    if (!flow.publishedVersionId) throw new ErroAutomacao("sem_versao_publicada");
    // O acesso à sessão é rechecado a cada início (pode ter sido revogado ou a sessão recriada por outro usuário).
    if (!(await canAccessSession(i.userId, i.role, flow.sessionId))) throw new ErroAutomacao("sessao_invalida");
    // Só contatos que já existem na sessão: sem isso o disparo manual viraria envio a números arbitrários.
    const contato = await prisma.contact.findFirst({ where: { session: { sessionId: flow.sessionId }, OR: [{ jid: i.contactKey }, { remoteJidAlt: i.contactKey }] }, select: { id: true } });
    if (!contato) throw new ErroAutomacao("contato_desconhecido");
    const versao = await prisma.automationFlowVersion.findUniqueOrThrow({ where: { id: flow.publishedVersionId }, select: { id: true, definition: true } });

    const ativas = await prisma.automationRun.count({ where: { flowId: flow.id, contactKey: i.contactKey, status: { in: STATUS_ATIVOS } } });
    if (ativas >= MAX_SIMULTANEAS_POR_CONTATO_FLUXO) return { ok: false, motivo: "limite_simultaneas" };
    const desde = new Date(agora.getTime() - 3_600_000);
    if ((await prisma.automationRun.count({ where: { userId: i.userId, createdAt: { gte: desde } } })) >= limitePorUsuarioHora()) return { ok: false, motivo: "limite_taxa" };
    if ((await prisma.automationRun.count({ where: { flowId: flow.id, createdAt: { gte: desde } } })) >= limitePorFluxoHora()) return { ok: false, motivo: "limite_taxa" };

    const dedupeKey = (i.dedupeKey ?? `janela:${Math.floor(agora.getTime() / JANELA_DEDUP_MS)}`).slice(0, 120);
    const contexto: Contexto = { vars: {}, tentativas: {} };
    try {
        const r = await prisma.automationRun.create({
            data: {
                userId: i.userId, flowId: flow.id, flowVersionId: versao.id, sessionId: flow.sessionId, contactKey: i.contactKey, dedupeKey,
                currentNodeId: (versao.definition as unknown as Definicao).start, context: json(contexto),
                deadlineAt: new Date(agora.getTime() + TIMEOUT_TOTAL_MS),
            },
        });
        return { ok: true, runId: r.id };
    } catch (e) {
        if (!isUnique(e)) throw e;
        const existente = await prisma.automationRun.findFirst({ where: { flowVersionId: versao.id, contactKey: i.contactKey, dedupeKey }, select: { id: true } });
        return { ok: false, motivo: "duplicada", runId: existente?.id };
    }
}

/** Cancela uma execução do usuário. Um envio já em curso não pode ser recolhido: o executor percebe o cancelamento ao salvar. */
export async function cancelarRun(userId: string, runId: string, motivo: MotivoCancelamento = "manual"): Promise<boolean> {
    const r = await prisma.automationRun.updateMany({
        where: { id: runId, userId, status: { in: STATUS_ATIVOS } },
        data: { status: "cancelled", motivoFim: motivo, finishedAt: new Date(), resumeAt: null, claimedBy: null, claimExpiresAt: null },
    });
    return r.count === 1;
}

export async function inspecionarRun(userId: string, runId: string) {
    const run = await prisma.automationRun.findFirst({ where: { id: runId, userId }, include: { steps: { orderBy: { seq: "asc" } } } });
    if (!run) throw new ErroAutomacao("nao_encontrado");
    return run;
}

export const listarFluxos = (userId: string) =>
    prisma.automationFlow.findMany({ where: { userId }, select: { id: true, name: true, sessionId: true, status: true, publishedVersionId: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 100 });
