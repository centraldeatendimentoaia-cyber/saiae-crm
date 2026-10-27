import { describe, it, expect } from "vitest";
import { casaRegra, normalizarFrase } from "./autoreply-match";

describe("casaRegra", () => {
    it("EXACT casa a frase inteira, sem diferenciar maiúsculas, acento nem espaços extras", () => {
        const r = { keyword: "Qual o horário?", matchType: "EXACT" };
        expect(casaRegra(r, "  qual o   HORARIO?")).toBe(true);
        expect(casaRegra(r, "qual o horário? e o endereço")).toBe(false);
        expect(casaRegra(r, "qual o horário")).toBe(false);
    });

    it("STARTS_WITH casa só o começo da mensagem", () => {
        const r = { keyword: "orçamento", matchType: "STARTS_WITH" };
        expect(casaRegra(r, "Orcamento para mechas")).toBe(true);
        expect(casaRegra(r, "quero um orçamento")).toBe(false);
    });

    it("CONTAINS casa em qualquer ponto", () => {
        expect(casaRegra({ keyword: "preço", matchType: "CONTAINS" }, "Qual o PRECO da escova?")).toBe(true);
    });

    it("REGEX usa o texto original e regex inválida não casa", () => {
        expect(casaRegra({ keyword: "^oi+$", matchType: "REGEX" }, "OIII")).toBe(true);
        expect(casaRegra({ keyword: "(", matchType: "REGEX" }, "(")).toBe(false);
    });

    it("palavra-chave vazia e tipo desconhecido nunca casam", () => {
        expect(casaRegra({ keyword: "   ", matchType: "CONTAINS" }, "qualquer coisa")).toBe(false);
        expect(casaRegra({ keyword: "oi", matchType: "PARECIDO" }, "oi")).toBe(false);
    });
});

describe("normalizarFrase", () => {
    it("tira acento, caixa e espaços repetidos", () => {
        expect(normalizarFrase("  Olá,   Tudo BEM ")).toBe("ola, tudo bem");
    });
});
