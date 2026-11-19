import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { CloudApiError } from "@/modules/whatsapp/cloud/errors";
import { BACKOFF_MS, MAX_ATTEMPTS } from "@/lib/send-failure";
import { executarRun, processarProntas } from "./executor";
import { criarDeps, criarStoreMemoria } from "./testes-util";
import { validarDefinicao } from "./validador";
import { CLAIM_TTL_MS, MAX_PASSOS, type Definicao } from "./tipos";

const T0 = Date.parse("2026-11-13T12:00:00Z");
const MIN = 60_000;
const D = (nodes: Definicao["nodes"], start = "a"): Definicao => ({ schemaVersion: 1, start, nodes });

const simples = D({ a: { type: "texto", text: "oi", next: "f" }, f: { type: "fim" } });
const comEspera = D({
    v: { type: "variavel", nome: "nome", valor: "Ana", next: "w" },
    w: { type: "espera", ms: 10 * MIN, next: "t" },
    t: { type: "texto", text: "Oi {{nome}}", next: "f" },
    f: { type: "fim" },
}, "v");

function cenario(def: Definicao, extra = {}, depsOpts: Parameters<typeof criarDeps>[0] extends infer O ? Partial<O> : never = {}) {
    const agora = { t: T0 };
    const m = criarStoreMemoria({ v1: def });
    m.criar("r1", "v1", new Date(T0), extra);
    const deps = criarDeps({ agora, ...depsOpts });
    return { ...m, agora, deps, run: () => m.runs.get("r1")! };
}

describe("transições de estado", () => {
    it("pending -> running -> completed, com passos registrados", async () => {
        const c = cenario(simples);
        expect(c.run().status).toBe("pending");
        expect(await executarRun("r1", c.store, c.deps)).toBe("completed");
        expect(c.run().status).toBe("completed");
        expect(c.run().claimedBy).toBeNull();
        expect(c.deps.sendText).toHaveBeenCalledTimes(1);
        expect(c.passos.map((p) => [p.nodeId, p.status])).toEqual([["a", "done"], ["f", "done"]]);
    });
    it("estado final não é reexecutado", async () => {
        const c = cenario(simples);
        await executarRun("r1", c.store, c.deps);
        expect(await executarRun("r1", c.store, c.deps)).toBe("nao_reivindicada");
        expect(c.deps.sendText).toHaveBeenCalledTimes(1);
    });
    it("variável, espera e retomada; contexto sobrevive ao reinício", async () => {
        const c = cenario(comEspera);
        expect(await executarRun("r1", c.store, c.deps)).toBe("waiting");
        expect(c.run().status).toBe("waiting");
        expect(c.run().currentNodeId).toBe("t");
        expect(c.run().context.vars).toEqual({ nome: "Ana" });
        // antes do prazo: ninguém reivindica
        c.agora.t += 5 * MIN;
        expect(await executarRun("r1", c.store, c.deps)).toBe("nao_reivindicada");
        // "reinício": novo executor (outro holder), mesmo banco, prazo vencido
        c.agora.t += 6 * MIN;
        const depois = criarDeps({ agora: c.agora, holder: "B" });
        expect(await processarProntas(c.store, depois)).toMatchObject({ completed: 1 });
        expect(depois.sendText).toHaveBeenCalledWith("5561999990001@s.whatsapp.net", "Oi Ana");
        expect(c.deps.sendText).not.toHaveBeenCalled();
    });
    it("condição escolhe o ramo e etiqueta chama o gancho", async () => {
        const def = D({
            v: { type: "variavel", nome: "plano", valor: "pro", next: "c" },
            c: { type: "condicao", expr: { op: "eq", a: { var: "plano" }, b: "pro" }, then: "e", else: "f" },
            e: { type: "etiqueta", nome: "VIP", next: "f" },
            f: { type: "fim" },
        }, "v");
        const c = cenario(def);
        expect(await executarRun("r1", c.store, c.deps)).toBe("completed");
        expect(c.deps.etiquetar).toHaveBeenCalledWith("loja", "5561999990001@s.whatsapp.net", "VIP");
    });
    it("transferência humana marca a conversa e encerra", async () => {
        const c = cenario(D({ a: { type: "transferencia_humana" } }));
        expect(await executarRun("r1", c.store, c.deps)).toBe("completed");
        expect(c.deps.transferirHumano).toHaveBeenCalledTimes(1);
        expect(c.run().motivoFim).toBe("transferencia_humana");
    });
});

describe("concorrência", () => {
    it("dois executores na mesma execução: só um envia", async () => {
        const c = cenario(simples);
        const b = criarDeps({ agora: c.agora, holder: "B", sendText: c.deps.sendText });
        const r = await Promise.all([executarRun("r1", c.store, c.deps), executarRun("r1", c.store, b)]);
        expect(r.filter((x) => x === "nao_reivindicada")).toHaveLength(1);
        expect(c.deps.sendText).toHaveBeenCalledTimes(1);
    });
    it("duas varreduras paralelas não duplicam o envio", async () => {
        const c = cenario(simples);
        const b = criarDeps({ agora: c.agora, holder: "B", sendText: c.deps.sendText });
        await Promise.all([processarProntas(c.store, c.deps), processarProntas(c.store, b)]);
        expect(c.deps.sendText).toHaveBeenCalledTimes(1);
    });
});

describe("queda no meio do envio ou da espera", () => {
    it("morre depois de enviar e antes de confirmar: marca unknown e NÃO reenvia", async () => {
        const c = cenario(simples);
        c.falhas.fecharPassoDone = true;
        await expect(executarRun("r1", c.store, c.deps)).rejects.toThrow("MORREU");
        expect(c.deps.sendText).toHaveBeenCalledTimes(1);
        expect(c.passos[0].status).toBe("claimed");
        // reservada pelo processo morto: enquanto a reserva vale, ninguém mexe
        const outro = criarDeps({ agora: c.agora, holder: "B", sendText: c.deps.sendText });
        expect(await executarRun("r1", c.store, outro)).toBe("nao_reivindicada");
        // reserva vencida: reconcilia como resultado desconhecido
        c.falhas.fecharPassoDone = false;
        c.agora.t += CLAIM_TTL_MS + 1;
        expect(await executarRun("r1", c.store, outro)).toBe("failed");
        expect(c.run().failureClass).toBe("unknown");
        expect(c.passos[0].status).toBe("unknown");
        expect(c.deps.sendText).toHaveBeenCalledTimes(1);
    });
    it("morre depois de confirmar o envio e antes de avançar: avança sem reenviar", async () => {
        const c = cenario(simples);
        // 1ª gravação do executor é o salvar após o envio
        c.falhas.salvarApos = 0;
        await expect(executarRun("r1", c.store, c.deps)).rejects.toThrow("MORREU");
        expect(c.passos[0].status).toBe("done");
        c.agora.t += CLAIM_TTL_MS + 1;
        const outro = criarDeps({ agora: c.agora, holder: "B", sendText: c.deps.sendText });
        expect(await executarRun("r1", c.store, outro)).toBe("completed");
        expect(c.deps.sendText).toHaveBeenCalledTimes(1);
    });
    it("processo abandonado fora de envio é retomado", async () => {
        const c = cenario(comEspera);
        c.falhas.salvarApos = 0; // morre ao gravar a variável
        await expect(executarRun("r1", c.store, c.deps)).rejects.toThrow("MORREU");
        c.agora.t += CLAIM_TTL_MS + 1;
        expect(await executarRun("r1", c.store, criarDeps({ agora: c.agora, holder: "B" }))).toBe("waiting");
    });
});

describe("falhas de envio e política", () => {
    it("resultado desconhecido (timeout): falha unknown, sem reenviar nunca", async () => {
        const c = cenario(simples, {}, { sendText: vi.fn(async () => { throw new Error("ETIMEDOUT"); }) });
        expect(await executarRun("r1", c.store, c.deps)).toBe("failed");
        expect(c.run().failureClass).toBe("unknown");
        expect(c.passos[0].status).toBe("unknown");
        c.agora.t += 30 * 24 * 3_600_000;
        expect(await processarProntas(c.store, c.deps)).toMatchObject({ completed: 0, failed: 0 });
        expect(c.deps.sendText).toHaveBeenCalledTimes(1);
    });
    it("falha transitória retenta com backoff e esgota", async () => {
        const send = vi.fn(async () => { throw new CloudApiError("rate_limit", "limite"); });
        const c = cenario(simples, {}, { sendText: send });
        expect(await executarRun("r1", c.store, c.deps)).toBe("waiting");
        expect(c.run().resumeAt!.getTime()).toBe(T0 + BACKOFF_MS[0]);
        for (let i = 1; i < MAX_ATTEMPTS; i++) {
            c.agora.t = c.run().resumeAt!.getTime();
            await executarRun("r1", c.store, c.deps);
        }
        expect(c.run().status).toBe("failed");
        expect(c.run().failureClass).toBe("transient");
        expect(send).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    });
    it("transitória que depois dá certo continua o fluxo", async () => {
        const send = vi.fn().mockRejectedValueOnce(new CloudApiError("rate_limit", "limite")).mockResolvedValue({ messageId: "w" });
        const c = cenario(simples, {}, { sendText: send });
        await executarRun("r1", c.store, c.deps);
        c.agora.t += BACKOFF_MS[0];
        expect(await executarRun("r1", c.store, c.deps)).toBe("completed");
    });
    it("Cloud com janela de 24 h fechada: policy, sem enviar e sem retentar", async () => {
        const c = cenario(simples, {}, { freeText: false, janela: false });
        expect(await executarRun("r1", c.store, c.deps)).toBe("failed");
        expect(c.run().failureClass).toBe("policy");
        expect(c.deps.sendText).not.toHaveBeenCalled();
        c.agora.t += 24 * 3_600_000;
        expect(await processarProntas(c.store, c.deps)).toMatchObject({ waiting: 0, completed: 0 });
    });
    it("Cloud com janela aberta envia", async () => {
        const c = cenario(simples, {}, { freeText: false, janela: true });
        expect(await executarRun("r1", c.store, c.deps)).toBe("completed");
    });
    it("template da Cloud sai mesmo com a janela fechada", async () => {
        const def = D({ a: { type: "template", name: "aviso", languageCode: "pt_BR", params: ["{{n}}"], next: "f" }, f: { type: "fim" } });
        const c = cenario(def, {}, { freeText: false, janela: false });
        expect(await executarRun("r1", c.store, c.deps)).toBe("completed");
    });
    it("política do provedor (descadastrado) vira policy e não retenta", async () => {
        const c = cenario(simples, {}, { sendText: vi.fn(async () => { throw new Error("Descadastrado (respondeu SAIR)"); }) });
        expect(await executarRun("r1", c.store, c.deps)).toBe("failed");
        expect(c.run().failureClass).toBe("policy");
    });
    it("sessão desconectada não cria reserva e retenta depois", async () => {
        const c = cenario(simples, {}, { conectado: false });
        expect(await executarRun("r1", c.store, c.deps)).toBe("waiting");
        expect(c.passos).toHaveLength(0);
    });
});

describe("cancelamento", () => {
    it("humano assumiu: cancela sem enviar (quemPodeEnviar)", async () => {
        const c = cenario(simples, {}, { conversa: { estado: "humano", pausadaAte: new Date(T0 + 3_600_000) } });
        expect(await executarRun("r1", c.store, c.deps)).toBe("cancelled");
        expect(c.run().motivoFim).toBe("humano_assumiu");
        expect(c.deps.sendText).not.toHaveBeenCalled();
    });
    it("pausa humana vencida: a automação segue", async () => {
        const c = cenario(simples, {}, { conversa: { estado: "humano", pausadaAte: new Date(T0 - 1) } });
        expect(await executarRun("r1", c.store, c.deps)).toBe("completed");
    });
    it("opt-out: cancela sem enviar", async () => {
        const c = cenario(simples, {}, { optout: true });
        expect(await executarRun("r1", c.store, c.deps)).toBe("cancelled");
        expect(c.run().motivoFim).toBe("optout");
        expect(c.deps.sendText).not.toHaveBeenCalled();
    });
    it("humano assume durante a espera: cancela ao retomar, sem o envio seguinte", async () => {
        const c = cenario(comEspera);
        await executarRun("r1", c.store, c.deps);
        c.agora.t += 11 * MIN;
        const depois = criarDeps({ agora: c.agora, holder: "B", conversa: { estado: "humano", pausadaAte: new Date(c.agora.t + 3_600_000) } });
        expect(await executarRun("r1", c.store, depois)).toBe("cancelled");
        expect(depois.sendText).not.toHaveBeenCalled();
    });
    it("cancelamento manual durante a espera impede a retomada", async () => {
        const c = cenario(comEspera);
        await executarRun("r1", c.store, c.deps);
        c.run().status = "cancelled"; // o que cancelarRun faz no banco
        c.agora.t += 11 * MIN;
        expect(await executarRun("r1", c.store, c.deps)).toBe("nao_reivindicada");
    });
    it("cancelamento externo no meio da execução: o executor percebe e para", async () => {
        const c = cenario(comEspera);
        const original = c.store.salvar;
        c.store.salvar = async (...a) => { c.run().status = "cancelled"; return original(...a); }; // cancela antes da 1ª gravação
        expect(await executarRun("r1", c.store, c.deps)).toBe("perdida");
        expect(c.run().status).toBe("cancelled");
    });
});

describe("limites e loop infinito", () => {
    it("loop com espera termina por limite de passos", async () => {
        const def = D({ a: { type: "variavel", nome: "x", valor: "1", next: "w" }, w: { type: "espera", ms: 1000, next: "a" } });
        expect(validarDefinicao(def)).toEqual([]); // loop com espera é válido: o limite em tempo de execução é a rede de segurança
        const c = cenario(def);
        for (let i = 0; i < MAX_PASSOS + 10 && !["failed", "completed"].includes(c.run().status); i++) {
            c.agora.t += 2000;
            await processarProntas(c.store, c.deps);
        }
        expect(c.run().status).toBe("failed");
        expect(c.run().lastError).toMatch(/limite de passos/);
        expect(c.run().stepCount).toBeLessThanOrEqual(MAX_PASSOS);
    });
    it("loop sem espera inserido direto no banco (sem validar) também para", async () => {
        const def = D({ a: { type: "variavel", nome: "x", valor: "1", next: "b" }, b: { type: "variavel", nome: "y", valor: "1", next: "a" } });
        expect(validarDefinicao(def).join()).toMatch(/ciclo/);
        const c = cenario(def);
        expect(await executarRun("r1", c.store, c.deps)).toBe("failed");
        expect(c.run().lastError).toMatch(/limite de passos/);
    });
    it("timeout total", async () => {
        const c = cenario(comEspera);
        await executarRun("r1", c.store, c.deps);
        c.agora.t += 8 * 24 * 3_600_000;
        expect(await executarRun("r1", c.store, c.deps)).toBe("failed");
        expect(c.run().lastError).toMatch(/tempo total/);
        expect(c.deps.sendText).not.toHaveBeenCalled();
    });
    it("nó inexistente falha de forma controlada", async () => {
        const c = cenario(simples, { currentNodeId: "nao_existe" });
        expect(await executarRun("r1", c.store, c.deps)).toBe("failed");
    });
});
