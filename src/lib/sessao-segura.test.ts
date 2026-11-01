import { describe, expect, it } from "vitest";
import { podeSalvar } from "./sessao-segura";

describe("podeSalvar", () => {
    it("bloqueia dados de outra sessão", () => {
        expect(podeSalvar("b", "a", false)).toBe(false);
    });
    it("bloqueia enquanto já está salvando", () => {
        expect(podeSalvar("a", "a", true)).toBe(false);
    });
    it("bloqueia sem dados carregados", () => {
        expect(podeSalvar("a", null, false)).toBe(false);
    });
    it("libera quando os dados são da sessão atual", () => {
        expect(podeSalvar("a", "a", false)).toBe(true);
    });
});
