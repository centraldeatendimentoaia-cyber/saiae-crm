import { describe, it, expect } from "vitest";
import { avaliar, interpolar, validarExpr } from "./expressao";
import { validarDefinicao } from "./validador";
import type { Definicao, Expr } from "./tipos";

describe("condição segura", () => {
    const vars = { idade: 30, nome: "Ana", ok: true };
    it("operadores fixos", () => {
        expect(avaliar({ op: "gt", a: { var: "idade" }, b: 18 }, vars)).toBe(true);
        expect(avaliar({ op: "and", args: [{ op: "eq", a: { var: "nome" }, b: "Ana" }, { op: "not", arg: { op: "exists", a: { var: "x" } } }] }, vars)).toBe(true);
        expect(avaliar({ op: "in", a: { var: "nome" }, b: ["Ana", "Bia"] }, vars)).toBe(true);
        expect(avaliar({ op: "contains", a: { var: "nome" }, b: "n" }, vars)).toBe(true);
    });
    it("sem coerção de tipos", () => {
        expect(avaliar({ op: "gt", a: { var: "nome" }, b: 1 }, vars)).toBe(false);
        expect(avaliar({ op: "eq", a: { var: "idade" }, b: "30" }, vars)).toBe(false);
    });
    it("tentativas de injeção não executam nada nem alcançam o protótipo", () => {
        const globalAfetado = globalThis as Record<string, unknown>;
        const alvos = ["constructor", "__proto__", "prototype", "constructor.constructor", "process.exit()"];
        for (const v of alvos) {
            expect(validarExpr({ op: "exists", a: { var: v } }).length).toBeGreaterThan(0); // recusada ao publicar
            expect(avaliar({ op: "exists", a: { var: v } } as Expr, vars)).toBe(false); // e, se passar, não resolve
        }
        expect(avaliar({ op: "eq", a: { var: "toString" }, b: null } as Expr, {})).toBe(false);
        // texto que parece código é só texto
        expect(avaliar({ op: "eq", a: "globalThis.__pwn = 1", b: "x" }, vars)).toBe(false);
        expect(globalAfetado.__pwn).toBeUndefined();
        expect(validarExpr({ op: "eval", a: "1" }).length).toBeGreaterThan(0);
        expect(validarExpr("1 == 1").length).toBeGreaterThan(0);
        expect(validarExpr({ op: "eq", a: { var: "x", extra: 1 }, b: 1 }).length).toBeGreaterThan(0);
    });
    it("limita o aninhamento", () => {
        let e: unknown = { op: "exists", a: { var: "x" } };
        for (let i = 0; i < 12; i++) e = { op: "not", arg: e };
        expect(validarExpr(e).length).toBeGreaterThan(0);
        expect(() => avaliar(e as Expr, {})).toThrow();
    });
});

describe("interpolação", () => {
    it("troca {{var}} e esvazia ausentes", () => {
        expect(interpolar("Oi {{ nome }}, {{falta}}!", { nome: "Ana" })).toBe("Oi Ana, !");
    });
    it("passada única: valor com {{ }} não expande de novo", () => {
        expect(interpolar("{{a}}", { a: "{{b}}", b: "segredo" })).toBe("{{b}}");
    });
    it("não lê propriedades herdadas nem executa expressões", () => {
        expect(interpolar("{{constructor}}|{{__proto__}}|{{toString}}|{{1+1}}|{{process.env}}", {})).toBe("|||{{1+1}}|{{process.env}}");
    });
});

const base = (nodes: Definicao["nodes"], start = "a"): Definicao => ({ schemaVersion: 1, start, nodes });

describe("validador de grafo", () => {
    it("aceita fluxo válido", () => {
        expect(validarDefinicao(base({ a: { type: "texto", text: "oi", next: "b" }, b: { type: "fim" } }))).toEqual([]);
    });
    it("destino inexistente, órfão, start e schemaVersion", () => {
        expect(validarDefinicao(base({ a: { type: "texto", text: "oi", next: "zz" } })).join()).toMatch(/destino inexistente/);
        expect(validarDefinicao(base({ a: { type: "fim" }, o: { type: "fim" } })).join()).toMatch(/órfão/);
        expect(validarDefinicao(base({ a: { type: "fim" } }, "x")).join()).toMatch(/start/);
        expect(validarDefinicao({ ...base({ a: { type: "fim" } }), schemaVersion: 2 }).join()).toMatch(/schemaVersion/);
    });
    it("ciclo sem espera é recusado; com espera é aceito", () => {
        const sem = base({ a: { type: "texto", text: "x", next: "b" }, b: { type: "texto", text: "y", next: "a" } });
        expect(validarDefinicao(sem).join()).toMatch(/ciclo sem nó de espera/);
        const cond = base({ a: { type: "condicao", expr: { op: "exists", a: { var: "x" } }, then: "a", else: "f" }, f: { type: "fim" } });
        expect(validarDefinicao(cond).join()).toMatch(/ciclo/);
        const com = base({ a: { type: "texto", text: "x", next: "w" }, w: { type: "espera", ms: 5000, next: "a" } });
        expect(validarDefinicao(com)).toEqual([]);
    });
    it("recusa tipo desconhecido, espera fora do limite, variável perigosa e condição inválida", () => {
        expect(validarDefinicao(base({ a: { type: "http" } as never })).join()).toMatch(/tipo desconhecido/);
        expect(validarDefinicao(base({ a: { type: "espera", ms: 1 } })).join()).toMatch(/espera/);
        expect(validarDefinicao(base({ a: { type: "variavel", nome: "__proto__", valor: "x" } })).join()).toMatch(/variável/);
        expect(validarDefinicao(base({ a: { type: "condicao", expr: { op: "x" } as never, then: "a", else: "a" } })).join()).toMatch(/operador/);
        expect(validarDefinicao(base({ a: { type: "texto", text: "x", next: "toString" } })).join()).toMatch(/destino inexistente/);
    });
});
