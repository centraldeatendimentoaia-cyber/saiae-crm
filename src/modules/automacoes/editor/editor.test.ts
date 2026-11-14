import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { Definicao } from "../tipos";
import { definicaoParaGrafo, grafoParaDefinicao, ligacaoPermitida, novoNo, removerNo } from "./grafo";
import { validarParaEditor } from "./validacao";
import { simularFluxo } from "./simulador";

const def: Definicao = {
    schemaVersion: 1, start: "oi",
    nodes: {
        oi: { type: "texto", text: "Oi {{nome}}!", next: "v" },
        v: { type: "variavel", nome: "plano", valor: "pro", next: "esp" },
        esp: { type: "espera", ms: 600_000, next: "cond" },
        cond: { type: "condicao", expr: { op: "eq", a: { var: "plano" }, b: "pro" }, then: "tag", else: "fim" },
        tag: { type: "etiqueta", nome: "VIP", next: "t2" },
        t2: { type: "template", name: "boas_vindas", languageCode: "pt_BR", params: ["{{nome}}"], next: "fim" },
        fim: { type: "fim" },
    },
};

describe("conversão grafo <-> JSON", () => {
    it("ida e volta devolve a mesma definição (com layout) e é idempotente", () => {
        const g = definicaoParaGrafo(def);
        const d1 = grafoParaDefinicao(g);
        const { layout, ...semLayout } = d1;
        expect(semLayout).toEqual(def);
        expect(Object.keys(layout!).sort()).toEqual(Object.keys(def.nodes).sort());
        const d2 = grafoParaDefinicao(definicaoParaGrafo(d1));
        expect(d2).toEqual(d1);
    });
    it("condição gera duas arestas then/else", () => {
        const g = definicaoParaGrafo(def);
        expect(g.edges.filter((e) => e.source === "cond").map((e) => e.sourceHandle).sort()).toEqual(["else", "then"]);
    });
    it("preserva posições e gatilho", () => {
        const g = definicaoParaGrafo({ ...def, layout: { oi: { x: 5, y: 7 } }, trigger: { tipo: "palavra_chave" } } as never);
        expect(g.nodes.find((n) => n.id === "oi")!.position).toEqual({ x: 5, y: 7 });
        expect(grafoParaDefinicao(g).trigger).toEqual({ tipo: "palavra_chave" });
    });
    it("remover nó limpa arestas e início; ligação respeita alças", () => {
        const g = definicaoParaGrafo(def);
        const r = removerNo(g, "oi");
        expect(r.start).toBe("");
        expect(r.edges.some((e) => e.source === "oi" || e.target === "oi")).toBe(false);
        expect(ligacaoPermitida(g, "fim", "next", "oi")).toBe(false);
        expect(ligacaoPermitida(g, "oi", "then", "v")).toBe(false);
        expect(ligacaoPermitida(g, "cond", "then", "v")).toBe(true);
        expect(ligacaoPermitida(g, "oi", "next", "inexistente")).toBe(false);
    });
    it("novoNo gera id único e padrão válido por tipo", () => {
        const g = definicaoParaGrafo(def);
        const n = novoNo("texto", g, { x: 0, y: 0 });
        expect(g.nodes.some((x) => x.id === n.id)).toBe(false);
        expect(n.data.type).toBe("texto");
    });
    it("fluxo montado pelo editor passa no validador do motor", () => {
        let g = definicaoParaGrafo({ schemaVersion: 1, start: "", nodes: {} });
        const a = novoNo("texto", g, { x: 0, y: 0 }); a.data.text = "Oi";
        g = { ...g, nodes: [a], start: a.id };
        const f = novoNo("fim", g, { x: 0, y: 100 });
        g = { ...g, nodes: [a, f], edges: [{ id: "e", source: a.id, target: f.id, sourceHandle: "next" }] };
        expect(validarParaEditor(grafoParaDefinicao(g)).ok).toBe(true);
    });
});

describe("validação por nó", () => {
    it("destino inexistente aparece no nó", () => {
        const r = validarParaEditor({ schemaVersion: 1, start: "a", nodes: { a: { type: "texto", text: "x", next: "zz" } } });
        expect(r.ok).toBe(false);
        expect(r.porNo.a.join()).toContain("destino inexistente");
    });
    it("espera acima do limite aparece no nó", () => {
        const r = validarParaEditor({ schemaVersion: 1, start: "e", nodes: { e: { type: "espera", ms: 99_999_999_999 } } });
        expect(r.porNo.e.join()).toContain("espera fora do limite");
    });
    it("órfão marcado", () => {
        const r = validarParaEditor({ schemaVersion: 1, start: "a", nodes: { a: { type: "fim" }, o: { type: "fim" } } });
        expect(r.porNo.o.join()).toContain("órfão");
    });
    it("ciclo sem espera marca os nós do ciclo; com espera é aceito", () => {
        const ciclo = { schemaVersion: 1, start: "a", nodes: { a: { type: "texto", text: "x", next: "b" }, b: { type: "texto", text: "y", next: "a" } } };
        const r = validarParaEditor(ciclo);
        expect(r.gerais.join()).toContain("ciclo");
        expect(Object.keys(r.porNo).sort()).toEqual(["a", "b"]);
        const ok = { schemaVersion: 1, start: "a", nodes: { a: { type: "texto", text: "x", next: "e" }, e: { type: "espera", ms: 5000, next: "a" } } };
        expect(validarParaEditor(ok).ok).toBe(true);
    });
    it("entrada inválida não lança", () => {
        expect(validarParaEditor(null).ok).toBe(false);
        expect(validarParaEditor({ schemaVersion: 1, nodes: [] }).ok).toBe(false);
    });
});

describe("simulador", () => {
    it("percorre o caminho, avança o relógio nas esperas e coleta mensagens, etiquetas e variáveis", async () => {
        const r = await simularFluxo(def, { variaveis: { nome: "Ana" } });
        expect(r.status).toBe("completed");
        expect(r.mensagens.map((m) => [m.tipo, m.conteudo])).toEqual([["texto", "Oi Ana!"], ["template", "boas_vindas"]]);
        expect(r.mensagens[1].params).toEqual(["Ana"]);
        expect(r.mensagens[0].nodeId).toBe("oi");
        expect(r.esperas).toEqual([{ nodeId: "esp", ms: 600_000, deMs: 0, ateMs: 600_000 }]);
        expect(r.mensagens[1].emMs).toBe(600_000);
        expect(r.etiquetas).toEqual(["VIP"]);
        expect(r.variaveis.plano).toBe("pro");
        expect(r.caminho.map((p) => p.nodeId)).toEqual(["oi", "v", "esp", "cond", "tag", "t2", "fim"]);
        expect(r.duracaoMs).toBe(600_000);
    });
    it("definição inválida não executa nada", async () => {
        const r = await simularFluxo({ schemaVersion: 1, start: "x", nodes: {} } as Definicao);
        expect(r.status).toBe("invalida");
        expect(r.mensagens).toHaveLength(0);
    });
    it("transferência humana e janela fechada (texto bloqueado, como na Cloud)", async () => {
        const h = await simularFluxo({ schemaVersion: 1, start: "a", nodes: { a: { type: "transferencia_humana" } } });
        expect(h.transferiuHumano).toBe(true);
        const j = await simularFluxo({ schemaVersion: 1, start: "a", nodes: { a: { type: "texto", text: "oi" } } }, { janelaAberta: false });
        expect(j.status).toBe("failed");
        expect(j.mensagens).toHaveLength(0);
    });
    it("loop com espera termina no limite de simulação sem travar", async () => {
        const r = await simularFluxo({ schemaVersion: 1, start: "a", nodes: { a: { type: "texto", text: "x", next: "e" }, e: { type: "espera", ms: 1000, next: "a" } } }, { maxRodadas: 5 });
        expect(r.status).toBe("limite_de_simulacao");
        expect(r.mensagens.length).toBeGreaterThan(0);
    });
    it("não há chamada de envio real: módulo não importa Prisma nem provedores reais", () => {
        const fonte = readFileSync(join(__dirname, "simulador.ts"), "utf8");
        const imports = fonte.split("\n").filter((l) => l.startsWith("import"));
        expect(imports.join("\n")).not.toMatch(/prisma|cloud\/client|baileys|session-manager|getProvider|fetch/i);
        expect(fonte).not.toMatch(/\bfetch\(|graph\.facebook/);
    });
});
