import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
    ownerIdOfSession: vi.fn(), assertCanSend: vi.fn(), recordMessages: vi.fn(),
    onlyInteractedEnabled: vi.fn(), hasInteracted: vi.fn(), PlanError: class extends Error {},
}));


vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/optout", () => ({ isOptedOut: vi.fn() }));
vi.mock("@/lib/safe-mode", () => ({ getSafeMode: vi.fn(), safeGate: vi.fn(), humanDelayMs: vi.fn(), batchPauseMs: vi.fn(), sleepMs: vi.fn() }));
vi.mock("@/modules/whatsapp/provider", () => ({ cloudSessionIds: () => new Set(["cloud"]), getProvider: vi.fn() }));
vi.mock("@/modules/whatsapp/provider/cloud-sessao", () => ({ numeroDeEnvioPertence: () => true }));
vi.mock("@/lib/plans", () => ({ ...m, }));
vi.mock("@/lib/interaction", () => ({ onlyInteractedEnabled: m.onlyInteractedEnabled, hasInteracted: m.hasInteracted, NO_INTERACTION_ERROR: "Sem conversa anterior (modo: só quem já interagiu)" }));

import { depsReais } from "./store-prisma";

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
