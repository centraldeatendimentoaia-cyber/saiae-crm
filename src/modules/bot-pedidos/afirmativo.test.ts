import { describe, expect, it } from "vitest";
import { escolhaDeConfirmacao, isAfirmativo, isSaudacao } from "./afirmativo";

describe("isAfirmativo", () => {
    it.each(["sim", "Sim!", "s", "pode", "confirmo", "Pode ser.", "ok", "👍", "SIM"])("aceita %s", (t) => expect(isAfirmativo(t)).toBe(true));
    it.each(["não", "nao", "sim mas troca o molho", "talvez", "", "quero mais um", "não pode", "sim, e tira a cebola"])("recusa %s", (t) => expect(isAfirmativo(t)).toBe(false));
});

describe("isSaudacao", () => {
    it("só saudação pura", () => {
        expect(isSaudacao("Oi!")).toBe(true);
        expect(isSaudacao("Boa tarde")).toBe(true);
        expect(isSaudacao("oi, quero 2 pasteis")).toBe(false);
    });
});

describe("escolhaDeConfirmacao", () => {
    const ambos = { na_entrega: true, pix: true };
    it("SIM paga na retirada e PIX paga agora", () => {
        expect(escolhaDeConfirmacao("sim", ambos)).toBe("na_entrega");
        expect(escolhaDeConfirmacao("Pix", ambos)).toBe("pix");
    });
    it("só Pix: SIM vira Pix; sem Pix, PIX não vale", () => {
        expect(escolhaDeConfirmacao("sim", { na_entrega: false, pix: true })).toBe("pix");
        expect(escolhaDeConfirmacao("pix", { na_entrega: true, pix: false })).toBeNull();
    });
    it("texto não afirmativo ou sem forma de pagamento não confirma", () => {
        expect(escolhaDeConfirmacao("talvez", ambos)).toBeNull();
        expect(escolhaDeConfirmacao("sim", { na_entrega: false, pix: false })).toBeNull();
    });
});
