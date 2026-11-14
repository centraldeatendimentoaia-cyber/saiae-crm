import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
    ownerIdOfSession: vi.fn(), assertCanSend: vi.fn(), recordMessages: vi.fn(),
    prisma: { agenteConversa: { findUnique: vi.fn() }, iaConversa: { findMany: vi.fn() } },
    onlyInteractedEnabled: vi.fn(), hasInteracted: vi.fn(), PlanError: class extends Error {},
}));


vi.mock("@/lib/prisma", () => ({ prisma: m.prisma }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/optout", () => ({ isOptedOut: vi.fn() }));
vi.mock("@/lib/safe-mode", () => ({ getSafeMode: vi.fn(), safeGate: vi.fn(), humanDelayMs: vi.fn(), batchPauseMs: vi.fn(), sleepMs: vi.fn() }));
vi.mock("@/modules/whatsapp/provider", () => ({ cloudSessionIds: () => new Set(["cloud"]), getProvider: vi.fn() }));
vi.mock("@/modules/whatsapp/provider/cloud-sessao", () => ({ numeroDeEnvioPertence: () => true }));
vi.mock("@/lib/plans", () => ({ ...m, }));
vi.mock("@/lib/interaction", () => ({ onlyInteractedEnabled: m.onlyInteractedEnabled, hasInteracted: m.hasInteracted, NO_INTERACTION_ERROR: "Sem conversa anterior (modo: só quem já interagiu)" }));

import { depsReais } from "./store-prisma";
import { executarRun } from "./executor";
import { criarDeps, criarStoreMemoria } from "./testes-util";
import type { Definicao } from "./tipos";

beforeEach(() => {
    vi.clearAllMocks();
    m.ownerIdOfSession.mockResolvedValue("dono");
    m.assertCanSend.mockResolvedValue(undefined);
    m.onlyInteractedEnabled.mockResolvedValue(false);
    m.hasInteracted.mockResolvedValue(true);
});

describe("depsReais.politicaEnvio (mesmas regras do agendador)", () => {
    it("tudo liberado", async () => {
        expect(await depsReais.politicaEnvio("loja", "5561999990001")).toEqual({ ok: true });
        expect(m.assertCanSend).toHaveBeenCalledWith("dono", 1);
    });
    it("plano sem cota/suspenso: bloqueia como política", async () => {
        m.assertCanSend.mockRejectedValue(new m.PlanError("Você usou todos os envios"));
        const r = await depsReais.politicaEnvio("loja", "5561999990001");
        expect(r).toMatchObject({ ok: false, transitoria: false });
    });
    it("só quem já interagiu ligado e contato sem conversa: bloqueia", async () => {
        m.onlyInteractedEnabled.mockResolvedValue(true);
        m.hasInteracted.mockResolvedValue(false);
        expect(await depsReais.politicaEnvio("loja", "5561999990001")).toMatchObject({ ok: false, transitoria: false });
        m.hasInteracted.mockResolvedValue(true);
        expect(await depsReais.politicaEnvio("loja", "5561999990001")).toEqual({ ok: true });
    });
    it("erro de infraestrutura é transitório", async () => {
        m.assertCanSend.mockRejectedValue(new Error("banco fora"));
        expect(await depsReais.politicaEnvio("loja", "5561999990001")).toMatchObject({ ok: false, transitoria: true });
    });
    it("registrarConsumo conta no dono da sessão", async () => {
        await depsReais.registrarConsumo("loja");
        expect(m.recordMessages).toHaveBeenCalledWith("dono", 1);
    });
});

describe("achado 10: pausa humana da IA Cloud (IaConversa) vale para a automação", () => {
    const T0 = Date.parse("2026-11-13T12:00:00Z");
    const def: Definicao = { schemaVersion: 1, start: "a", nodes: { a: { type: "texto", text: "oi", next: "f" }, f: { type: "fim" } } };
    const ate = new Date(Date.now() + 3_600_000);
    const roda = async (sessionId: string) => {
        const agora = { t: T0 };
        const mem = criarStoreMemoria({ v1: def });
        mem.criar("r1", "v1", new Date(T0), { sessionId, contactKey: "5561999990001" });
        const deps = { ...criarDeps({ agora }), conversa: (s: string, c: string) => depsReais.conversa(s, c) };
        // relógio da execução = hoje, para a pausa gravada com Date.now() valer
        deps.agora = () => new Date();
        const r = await executarRun("r1", mem.store, deps);
        return { r, run: mem.runs.get("r1")!, deps };
    };
    beforeEach(() => { m.prisma.agenteConversa.findUnique.mockResolvedValue(null); });

    it("responsável assumiu a conversa Cloud (sem AgenteConversa): cancela por humano_assumiu e não envia", async () => {
        m.prisma.iaConversa.findMany.mockResolvedValue([{ estado: "humano", pausadaAte: ate }]);
        const { r, run, deps } = await roda("cloud");
        expect(r).toBe("cancelled");
        expect(run.motivoFim).toBe("humano_assumiu");
        expect(deps.sendText).not.toHaveBeenCalled();
    });
    it("pausa vencida na IaConversa: a automação envia", async () => {
        m.prisma.iaConversa.findMany.mockResolvedValue([{ estado: "humano", pausadaAte: new Date(Date.now() - 1000) }]);
        const { r } = await roda("cloud");
        expect(r).toBe("completed");
    });
    it("sessão que não é Cloud não consulta IaConversa", async () => {
        m.prisma.iaConversa.findMany.mockResolvedValue([{ estado: "humano", pausadaAte: ate }]);
        const { r } = await roda("baileys");
        expect(r).toBe("completed");
        expect(m.prisma.iaConversa.findMany).not.toHaveBeenCalled();
    });
    it("pausa no AgenteConversa continua valendo", async () => {
        m.prisma.agenteConversa.findUnique.mockResolvedValue({ estado: "humano", pausadaAte: ate });
        m.prisma.iaConversa.findMany.mockResolvedValue([]);
        const { r } = await roda("cloud");
        expect(r).toBe("cancelled");
    });
});
