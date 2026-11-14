import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { CloudApiError } from "@/modules/whatsapp/cloud/errors";
import { executarRun, processarProntas } from "./executor";
import { criarDeps, criarStoreMemoria } from "./testes-util";
import { validarDefinicao } from "./validador";
import { CLAIM_TTL_MS, ESPERA_MAX_MS, MAX_CLAIMS_SEM_PROGRESSO, TIMEOUT_TOTAL_MS, type Definicao } from "./tipos";

const T0 = Date.parse("2026-11-13T12:00:00Z");
const D = (nodes: Definicao["nodes"], start = "a"): Definicao => ({ schemaVersion: 1, start, nodes });
const simples = D({ a: { type: "texto", text: "oi", next: "f" }, f: { type: "fim" } });

function cenario(def: Definicao, depsOpts: Partial<Parameters<typeof criarDeps>[0]> = {}) {
    const agora = { t: T0 };
    const m = criarStoreMemoria({ v1: def });
    m.criar("r1", "v1", new Date(T0));
    const deps = criarDeps({ agora, ...depsOpts });
    return { ...m, agora, deps, run: () => m.runs.get("r1")! };
}

describe("acesso à sessão rechecado no executor", () => {
    it("acesso revogado / sessão recriada por outro usuário: cancela com sessao_invalida, sem enviar", async () => {
        const c = cenario(simples, { acesso: false });
        expect(await executarRun("r1", c.store, c.deps)).toBe("cancelled");
        expect(c.run().motivoFim).toBe("sessao_invalida");
        expect(c.deps.sendText).not.toHaveBeenCalled();
    });
    it("revogado durante a espera: cancela ao retomar, antes do envio seguinte", async () => {
        const def = D({ w: { type: "espera", ms: 60_000, next: "t" }, t: { type: "texto", text: "oi", next: "f" }, f: { type: "fim" } }, "w");
        const c = cenario(def);
        expect(await executarRun("r1", c.store, c.deps)).toBe("waiting");
        c.agora.t += 61_000;
        const sem = criarDeps({ agora: c.agora, acesso: false });
        expect(await executarRun("r1", c.store, sem)).toBe("cancelled");
        expect(c.run().motivoFim).toBe("sessao_invalida");
        expect(sem.sendText).not.toHaveBeenCalled();
    });
});

describe("execução envenenada", () => {
    const rodarAteParar = async (c: ReturnType<typeof cenario>) => {
        let chamadas = 0;
        for (; chamadas < 20 && c.run().status !== "failed"; chamadas++) {
            c.agora.t += CLAIM_TTL_MS + 1000; // a reserva abandonada vence e a próxima rodada reivindica de novo
            await executarRun("r1", c.store, c.deps).catch(() => "erro");
        }
        return chamadas;
    };
    it("definicao() lançando sempre: falha permanent após N reivindicações, sem enviar", async () => {
        const c = cenario(simples);
        c.store.definicao = async () => { throw new Error("banco fora"); };
        const n = await rodarAteParar(c);
        expect(c.run().status).toBe("failed");
        expect(c.run().failureClass).toBe("permanent");
        expect(c.run().lastError).toMatch(/reivindicações seguidas sem progresso/);
        expect(n).toBe(MAX_CLAIMS_SEM_PROGRESSO + 1);
        expect(c.deps.sendText).not.toHaveBeenCalled();
    });
    it("abrirPasso() lançando sempre: também falha permanent", async () => {
        const c = cenario(simples);
        c.store.abrirPasso = async () => { throw new Error("banco fora"); };
        await rodarAteParar(c);
        expect(c.run().failureClass).toBe("permanent");
    });
    it("execução saudável com várias esperas não é tratada como envenenada", async () => {
        const nodes: Definicao["nodes"] = {};
        for (let i = 0; i < 10; i++) nodes[`w${i}`] = { type: "espera", ms: 1000, next: i === 9 ? "f" : `w${i + 1}` };
        nodes.f = { type: "fim" };
        const c = cenario(D(nodes, "w0"));
        for (let i = 0; i < 12 && c.run().status !== "completed"; i++) { await executarRun("r1", c.store, c.deps); c.agora.t += 2000; }
        expect(c.run().status).toBe("completed");
    });
});

describe("tentativas por nó", () => {
    it("zera ao avançar de nó", async () => {
        const def = D({ a: { type: "texto", text: "oi", next: "w" }, w: { type: "espera", ms: 60_000, next: "f" }, f: { type: "fim" } });
        const send = vi.fn().mockRejectedValueOnce(new CloudApiError("rate_limit", "limite")).mockResolvedValue({ messageId: "w" });
        const c = cenario(def, { sendText: send });
        await executarRun("r1", c.store, c.deps);
        expect(c.run().context.tentativas).toEqual({ a: 1 });
        c.agora.t = c.run().resumeAt!.getTime();
        await executarRun("r1", c.store, c.deps);
        expect(c.run().context.tentativas).toEqual({});
    });
});

describe("Modo Seguro e espaçamento (Baileys)", () => {
    it("fora do horário seguro: espera a janela abrir, sem enviar e sem gastar tentativa", async () => {
        const abre = new Date(T0 + 3_600_000);
        const c = cenario(simples);
        c.deps.gateEnvio = async () => ({ ok: false, resumeAt: abre });
        expect(await executarRun("r1", c.store, c.deps)).toBe("waiting");
        expect(c.run().resumeAt).toEqual(abre);
        expect(c.deps.sendText).not.toHaveBeenCalled();
        expect(c.run().context.tentativas).toEqual({});
    });
    it("processarProntas espaça depois de cada envio e respeita o orçamento de tempo", async () => {
        const c = cenario(simples);
        c.deps.espacar = vi.fn(async () => {});
        await processarProntas(c.store, c.deps);
        expect(c.deps.espacar).toHaveBeenCalledTimes(1);
        const d = cenario(simples);
        const res = await processarProntas(d.store, d.deps, 50, -1);
        expect(Object.values(res).reduce((a, b) => a + b, 0)).toBe(0);
    });
});

describe("validador: esperas x prazo total", () => {
    it("ESPERA_MAX_MS não passa do prazo total", () => expect(ESPERA_MAX_MS).toBeLessThanOrEqual(TIMEOUT_TOTAL_MS));
    it("espera única maior que o prazo é rejeitada", () => {
        const def = D({ a: { type: "espera", ms: TIMEOUT_TOTAL_MS + 1, next: "f" }, f: { type: "fim" } });
        expect(validarDefinicao(def).join()).toMatch(/espera fora do limite/);
    });
    it("soma das esperas do caminho acima do prazo é rejeitada; ramos alternativos não somam", () => {
        const quatro = 4 * 24 * 3_600_000;
        const serie = D({ a: { type: "espera", ms: quatro, next: "b" }, b: { type: "espera", ms: quatro, next: "f" }, f: { type: "fim" } });
        expect(validarDefinicao(serie).join()).toMatch(/soma das esperas/);
        const ramos = D({
            c: { type: "condicao", expr: { op: "eq", a: 1, b: 1 }, then: "a", else: "b" },
            a: { type: "espera", ms: quatro, next: "f" }, b: { type: "espera", ms: quatro, next: "f" }, f: { type: "fim" },
        }, "c");
        expect(validarDefinicao(ramos)).toEqual([]);
    });
});
