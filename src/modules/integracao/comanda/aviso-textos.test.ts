import { describe, it, expect } from "vitest";
import { configDoAviso, montarMensagem, textoDoAviso, tipoDoEvento, TEXTO_MAX, VALIDADE_MS } from "./aviso-textos";
import type { ComandaEvent } from "./schema";

const ev = (type: ComandaEvent["type"], data: Record<string, unknown> = {}): ComandaEvent => ({
    id: "e", type, version: 1, occurred_at: "2026-10-23T12:00:00Z", barraca_id: "b", sequence: 1, data,
});

describe("tipoDoEvento", () => {
    it.each([
        ["order.created", {}, "recebido"],
        ["order.ready", {}, "pronto"],
        ["order.out_for_delivery", {}, "saiu_entrega"],
        ["order.cancelled", {}, "cancelado"],
        ["order.status_changed", { status: "entregue" }, "entregue"],
        ["order.status_changed", { status: "pronto" }, null],
        ["order.status_changed", { status: "a_fazer" }, null],
        ["order.paid", {}, null],
        ["customer.created", {}, null],
    ] as const)("%s %j → %s", (type, data, esperado) => {
        expect(tipoDoEvento(ev(type, data))).toBe(esperado);
    });
});

describe("validade", () => {
    it("usa os prazos aprovados", () => {
        expect(VALIDADE_MS).toEqual({ recebido: 30 * 60_000, pronto: 15 * 60_000, saiu_entrega: 15 * 60_000, entregue: 15 * 60_000, cancelado: 60 * 60_000 });
    });
});

describe("configDoAviso", () => {
    it("ausente = ativo com texto padrão", () => {
        expect(configDoAviso({}, "pronto")).toEqual({ ativo: true, texto: null });
        expect(configDoAviso({ avisos: "x" }, "pronto")).toEqual({ ativo: true, texto: null });
    });
    it("ativo:false desliga; texto em branco vale como ausente; texto é cortado", () => {
        expect(configDoAviso({ avisos: { pronto: { ativo: false, texto: "oi" } } }, "pronto")).toEqual({ ativo: false, texto: "oi" });
        expect(configDoAviso({ avisos: { pronto: { ativo: true, texto: "   " } } }, "pronto").texto).toBeNull();
        expect(configDoAviso({ avisos: { pronto: { texto: "a".repeat(900) } } }, "pronto").texto).toHaveLength(TEXTO_MAX);
    });
    it("não mistura tipos", () => {
        expect(configDoAviso({ avisos: { cancelado: { ativo: false } } }, "pronto").ativo).toBe(true);
    });
});

describe("montarMensagem", () => {
    it("preenche as três variáveis (primeiro nome, senha com #)", () => {
        expect(montarMensagem("Olá {nome}! Pedido {senha} da {barraca}.", { nome: "Maria Souza", senha: 42, barraca: "Açaí do Didi" })).toBe("Olá Maria! Pedido #42 da Açaí do Didi.");
    });
    it("variável sem valor some junto do espaço", () => {
        expect(montarMensagem("Olá {nome}! Pedido {senha} pronto.", { nome: "", senha: null, barraca: "X" })).toBe("Olá! Pedido pronto.");
    });
});

describe("textoDoAviso", () => {
    it("personalizado vence; pronto de entrega tem texto próprio", () => {
        expect(textoDoAviso("pronto", "meu texto", true)).toBe("meu texto");
        expect(textoDoAviso("pronto", null, true)).toContain("entrega");
        expect(textoDoAviso("pronto", null, false)).toContain("retirar");
    });
});
