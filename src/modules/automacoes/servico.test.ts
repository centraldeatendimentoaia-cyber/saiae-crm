import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    prisma: {
        automationFlow: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
        automationFlowVersion: { findFirst: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn() },
        automationRun: { count: vi.fn(), create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
        session: { findFirst: vi.fn() },
        contact: { findFirst: vi.fn() },
        $transaction: vi.fn(),
    },
    acesso: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/api-auth", () => ({ canAccessSession: h.acesso }));

import { ErroAutomacao, cancelarRun, cancelarRunsDoContato, criarFluxo, iniciarRun, publicarFluxo } from "./servico";
import { prismaStore } from "./store-prisma";

vi.mock("@/modules/whatsapp/provider", () => ({ cloudSessionIds: () => new Set(), getProvider: vi.fn() }));
vi.mock("@/lib/optout", () => ({ isOptedOut: vi.fn() }));

const flow = { id: "f1", userId: "u1", sessionId: "loja", status: "active", publishedVersionId: "v1", draft: {} };
const P2002 = Object.assign(new Error("unique"), { code: "P2002" });
const AGORA = new Date("2026-11-13T12:30:00Z");

beforeEach(() => {
    vi.clearAllMocks();
    h.prisma.automationFlow.findFirst.mockResolvedValue(flow);
    h.prisma.automationFlowVersion.findUniqueOrThrow.mockResolvedValue({ id: "v1", definition: { schemaVersion: 1, start: "a", nodes: {} } });
    h.prisma.automationRun.count.mockResolvedValue(0);
    h.acesso.mockResolvedValue(true);
    h.prisma.contact.findFirst.mockResolvedValue({ id: "ct1" });
    h.prisma.$transaction.mockImplementation((fn: (tx: typeof h.prisma) => unknown) => fn(h.prisma));
    delete process.env.AUTOMACOES_MAX_INICIOS_HORA_USUARIO;
    delete process.env.AUTOMACOES_MAX_INICIOS_HORA_FLUXO;
});

describe("sessão do fluxo (criarFluxo)", () => {
    it("cliente manda o cuid: grava o NOME da sessão", async () => {
        h.prisma.session.findFirst.mockResolvedValueOnce({ sessionId: "loja" });
        await criarFluxo({ userId: "u1", sessionId: "cuid123", name: "x" });
        expect(h.prisma.session.findFirst.mock.calls[0][0].where).toEqual({ id: "cuid123" });
        expect(h.prisma.automationFlow.create.mock.calls[0][0].data.sessionId).toBe("loja");
    });
    it("cliente manda o nome: resolve por nome e grava o mesmo nome", async () => {
        h.prisma.session.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ sessionId: "loja" });
        await criarFluxo({ userId: "u1", sessionId: "loja", name: "x" });
        expect(h.prisma.session.findFirst.mock.calls[1][0].where).toEqual({ sessionId: "loja" });
        expect(h.prisma.automationFlow.create.mock.calls[0][0].data.sessionId).toBe("loja");
    });
    it("sessão inexistente: erro e nada é criado", async () => {
        h.prisma.session.findFirst.mockResolvedValue(null);
        await expect(criarFluxo({ userId: "u1", sessionId: "zzz", name: "x" })).rejects.toMatchObject({ codigo: "sessao_invalida" });
        expect(h.prisma.automationFlow.create).not.toHaveBeenCalled();
    });
});

describe("início manual: acesso, contato e taxa", () => {
    it("acesso revogado à sessão do fluxo: recusa (canAccessSession com a sessão do fluxo)", async () => {
        h.acesso.mockResolvedValue(false);
        await expect(iniciarRun({ userId: "u1", role: "OWNER", flowId: "f1", contactKey: "c" })).rejects.toMatchObject({ codigo: "sessao_invalida" });
        expect(h.acesso).toHaveBeenCalledWith("u1", "OWNER", "loja");
        expect(h.prisma.automationRun.create).not.toHaveBeenCalled();
    });
    it("contato que não existe na sessão: recusa", async () => {
        h.prisma.contact.findFirst.mockResolvedValue(null);
        await expect(iniciarRun({ userId: "u1", role: "OWNER", flowId: "f1", contactKey: "5561000000000@s.whatsapp.net" })).rejects.toMatchObject({ codigo: "contato_desconhecido" });
        expect(h.prisma.contact.findFirst.mock.calls[0][0].where).toMatchObject({ session: { sessionId: "loja" } });
        expect(h.prisma.automationRun.create).not.toHaveBeenCalled();
    });
    it("teto por usuário na última hora (env): limite_taxa", async () => {
        process.env.AUTOMACOES_MAX_INICIOS_HORA_USUARIO = "2";
        h.prisma.automationRun.count.mockResolvedValueOnce(0).mockResolvedValueOnce(2);
        expect(await iniciarRun({ userId: "u1", role: "OWNER", flowId: "f1", contactKey: "c", agora: AGORA })).toEqual({ ok: false, motivo: "limite_taxa" });
        expect(h.prisma.automationRun.count.mock.calls[1][0].where).toMatchObject({ userId: "u1", createdAt: { gte: new Date(AGORA.getTime() - 3_600_000) } });
    });
    it("teto por fluxo (padrão 30/h): limite_taxa", async () => {
        h.prisma.automationRun.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(30);
        expect(await iniciarRun({ userId: "u1", role: "OWNER", flowId: "f1", contactKey: "c" })).toEqual({ ok: false, motivo: "limite_taxa" });
        expect(h.prisma.automationRun.create).not.toHaveBeenCalled();
    });
});

describe("início e deduplicação", () => {
    it("cria a execução no nó inicial com o escopo do fluxo (userId e sessão)", async () => {
        h.prisma.automationRun.create.mockResolvedValue({ id: "r1" });
        expect(await iniciarRun({ userId: "u1", role: "OWNER", flowId: "f1", contactKey: "c", agora: AGORA })).toEqual({ ok: true, runId: "r1" });
        const data = h.prisma.automationRun.create.mock.calls[0][0].data;
        expect(data).toMatchObject({ userId: "u1", sessionId: "loja", flowVersionId: "v1", currentNodeId: "a", contactKey: "c" });
        expect(data.dedupeKey).toBe(`janela:${Math.floor(AGORA.getTime() / 3_600_000)}`);
    });
    it("mesma versão, contato e janela: duplicada, sem segunda execução", async () => {
        h.prisma.automationRun.create.mockRejectedValue(P2002);
        h.prisma.automationRun.findFirst.mockResolvedValue({ id: "r0" });
        expect(await iniciarRun({ userId: "u1", role: "OWNER", flowId: "f1", contactKey: "c", agora: AGORA })).toEqual({ ok: false, motivo: "duplicada", runId: "r0" });
    });
    it("limite de execuções simultâneas por contato e fluxo", async () => {
        h.prisma.automationRun.count.mockResolvedValue(1);
        expect(await iniciarRun({ userId: "u1", role: "OWNER", flowId: "f1", contactKey: "c" })).toEqual({ ok: false, motivo: "limite_simultaneas" });
        expect(h.prisma.automationRun.create).not.toHaveBeenCalled();
    });
    it("fluxo de outro usuário não é encontrado (escopo por userId)", async () => {
        h.prisma.automationFlow.findFirst.mockResolvedValue(null);
        await expect(iniciarRun({ userId: "outro", role: "OWNER", flowId: "f1", contactKey: "c" })).rejects.toBeInstanceOf(ErroAutomacao);
        expect(h.prisma.automationFlow.findFirst.mock.calls[0][0].where).toMatchObject({ userId: "outro" });
    });
    it("sem versão publicada não inicia", async () => {
        h.prisma.automationFlow.findFirst.mockResolvedValue({ ...flow, publishedVersionId: null });
        await expect(iniciarRun({ userId: "u1", role: "OWNER", flowId: "f1", contactKey: "c" })).rejects.toMatchObject({ codigo: "sem_versao_publicada" });
    });
});

describe("publicação", () => {
    it("recusa rascunho inválido (validador de grafo) e não cria versão", async () => {
        h.prisma.automationFlow.findFirst.mockResolvedValue({ ...flow, draft: { schemaVersion: 1, start: "a", nodes: { a: { type: "texto", text: "x", next: "zz" } } } });
        await expect(publicarFluxo("u1", "f1")).rejects.toMatchObject({ codigo: "definicao_invalida" });
        expect(h.prisma.automationFlowVersion.create).not.toHaveBeenCalled();
    });
    it("publica como versão seguinte e aponta o fluxo para ela", async () => {
        h.prisma.automationFlow.findFirst.mockResolvedValue({ ...flow, draft: { schemaVersion: 1, start: "a", nodes: { a: { type: "fim" } } } });
        h.prisma.automationFlowVersion.findFirst.mockResolvedValue({ version: 3 });
        h.prisma.automationFlowVersion.create.mockResolvedValue({ id: "v4", version: 4 });
        await publicarFluxo("u1", "f1");
        expect(h.prisma.$transaction).toHaveBeenCalledTimes(1); // versão e ponteiro juntos
        expect(h.prisma.automationFlowVersion.create.mock.calls[0][0].data).toMatchObject({ flowId: "f1", version: 4 });
        expect(h.prisma.automationFlow.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { publishedVersionId: "v4" } });
    });
});

describe("cancelamento e claim no banco", () => {
    it("cancelarRun é escopado por userId e só atinge execuções ativas", async () => {
        h.prisma.automationRun.updateMany.mockResolvedValue({ count: 1 });
        expect(await cancelarRun("u1", "r1")).toBe(true);
        expect(h.prisma.automationRun.updateMany.mock.calls[0][0].where).toMatchObject({ id: "r1", userId: "u1", status: { in: ["pending", "running", "waiting"] } });
    });
    it("cancelarRunsDoContato cancela as ativas da sessão/contato", async () => {
        h.prisma.automationRun.updateMany.mockResolvedValue({ count: 2 });
        expect(await cancelarRunsDoContato("loja", "c", "optout")).toBe(2);
        expect(h.prisma.automationRun.updateMany.mock.calls[0][0].data).toMatchObject({ status: "cancelled", motivoFim: "optout" });
    });
    it("claim é um UPDATE condicional: count 0 = outra instância", async () => {
        h.prisma.automationRun.updateMany.mockResolvedValue({ count: 0 });
        expect(await prismaStore.claimRun("r1", "A", AGORA, 1000)).toBeNull();
        const where = h.prisma.automationRun.updateMany.mock.calls[0][0].where;
        expect(where.OR).toHaveLength(3);
        expect(where.id).toBe("r1");
    });
    it("salvar exige ser o dono e status running", async () => {
        h.prisma.automationRun.updateMany.mockResolvedValue({ count: 0 });
        expect(await prismaStore.salvar("r1", "A", { stepCount: 1 }, AGORA)).toBe(false);
        expect(h.prisma.automationRun.updateMany.mock.calls[0][0].where).toEqual({ id: "r1", claimedBy: "A", status: "running" });
    });
});
