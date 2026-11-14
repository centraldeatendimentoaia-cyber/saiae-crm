import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { CloudApiError } from "@/modules/whatsapp/cloud/errors";
import { executarRun } from "./executor";
import { criarDeps, criarStoreMemoria } from "./testes-util";
import { CLAIM_TTL_MS, type Definicao } from "./tipos";

const T0 = Date.parse("2026-11-13T12:00:00Z");
const D = (nodes: Definicao["nodes"], start = "a"): Definicao => ({ schemaVersion: 1, start, nodes });
const simples = D({ a: { type: "texto", text: "oi", next: "f" }, f: { type: "fim" } });
const duas = D({ a: { type: "texto", text: "um", next: "b" }, b: { type: "texto", text: "dois", next: "f" }, f: { type: "fim" } });

function cenario(def: Definicao, depsOpts: Partial<Parameters<typeof criarDeps>[0]> = {}) {
    const agora = { t: T0 };
    const m = criarStoreMemoria({ v1: def });
    m.criar("r1", "v1", new Date(T0));
    const deps = criarDeps({ agora, ...depsOpts });
    return { ...m, agora, deps, run: () => m.runs.get("r1")! };
}

describe("achado 1: resultado desconhecido nunca é reenviado", () => {
    it("timeout grava unknown, gravar o fim da execução falha: após o claim vencer, não reenvia e encerra como unknown", async () => {
        const timeout = vi.fn().mockRejectedValue(new CloudApiError("network", "timeout"));
        const c = cenario(simples, { sendText: timeout });
        c.falhas.salvarApos = 0; // o primeiro salvar (falhar("unknown")) morre: a run fica "running" com o passo "unknown"
        await expect(executarRun("r1", c.store, c.deps)).rejects.toThrow("MORREU");
        expect(c.passos.at(-1)?.status).toBe("unknown");
        expect(c.run().status).toBe("running");

        c.agora.t += CLAIM_TTL_MS + 1000;
        expect(await executarRun("r1", c.store, c.deps)).toBe("failed");
        expect(timeout).toHaveBeenCalledTimes(1);
        expect(c.run().failureClass).toBe("unknown");
        expect(c.passos.filter((p) => p.type === "texto")).toHaveLength(1);
    });
});

describe("achado 4: cancelamento antes da reserva impede o envio", () => {
    it("cancelada enquanto resolveRecipient aguarda: não chama o provedor", async () => {
        const c = cenario(simples);
        const original = c.deps.provider("loja");
        if (!original.ok) throw new Error("provider");
        const base = original.provider;
        c.deps.provider = () => ({ ok: true, provider: { ...base, resolveRecipient: async (to: string) => { c.run().status = "cancelled"; return to; } } as never });
        expect(await executarRun("r1", c.store, c.deps)).toBe("perdida");
        expect(c.deps.sendText).not.toHaveBeenCalled();
        expect(c.run().status).toBe("cancelled");
    });
    it("posse tomada por outra instância durante a espera: também não envia", async () => {
        const c = cenario(simples);
        const original = c.deps.provider("loja");
        if (!original.ok) throw new Error("provider");
        c.deps.provider = () => ({ ok: true, provider: { ...original.provider, resolveRecipient: async (to: string) => { c.run().claimedBy = "B"; return to; } } as never });
        expect(await executarRun("r1", c.store, c.deps)).toBe("perdida");
        expect(c.deps.sendText).not.toHaveBeenCalled();
    });
});

describe("achado 5: políticas dos outros envios", () => {
    it("política bloqueia (plano/cota ou só quem já interagiu): falha como policy, sem enviar nem consumir", async () => {
        const c = cenario(simples, { politica: { ok: false, transitoria: false, motivo: "Sem conversa anterior (modo: só quem já interagiu)" } });
        expect(await executarRun("r1", c.store, c.deps)).toBe("failed");
        expect(c.run().failureClass).toBe("policy");
        expect(c.deps.sendText).not.toHaveBeenCalled();
        expect(c.deps.registrarConsumo).not.toHaveBeenCalled();
    });
    it("falha transitória ao checar a política: espera e tenta de novo, sem enviar", async () => {
        const c = cenario(simples, { politica: { ok: false, transitoria: true, motivo: "banco fora" } });
        expect(await executarRun("r1", c.store, c.deps)).toBe("waiting");
        expect(c.deps.sendText).not.toHaveBeenCalled();
    });
    it("registra o consumo uma vez por mensagem enviada", async () => {
        const c = cenario(duas);
        expect(await executarRun("r1", c.store, c.deps)).toBe("completed");
        expect(c.deps.registrarConsumo).toHaveBeenCalledTimes(2);
    });
    it("falha ao registrar consumo não derruba a execução nem reenvia", async () => {
        const c = cenario(simples);
        c.deps.registrarConsumo.mockRejectedValue(new Error("contador fora"));
        expect(await executarRun("r1", c.store, c.deps)).toBe("completed");
        expect(c.deps.sendText).toHaveBeenCalledTimes(1);
    });
});
