import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { applyPlaceholders, extractNames, hasPlaceholders } from "./personalize";

describe("extractNames", () => {
    it("normaliza caixa e partículas", () => {
        expect(extractNames("MARIA DA SILVA")).toEqual({ full: "Maria da Silva", first: "Maria" });
    });
    it("remove emojis das pontas", () => {
        expect(extractNames("🌸 Maria ✨")?.first).toBe("Maria");
    });
    it("ignora telefone e texto sem letras", () => {
        expect(extractNames("+55 61 99953-1848")).toBeNull();
        expect(extractNames("")).toBeNull();
        expect(extractNames(null)).toBeNull();
    });
});

describe("applyPlaceholders", () => {
    it("troca {primeironome} e {nome}", () => {
        expect(applyPlaceholders("Oi, {primeironome}!", "maria da silva")).toBe("Oi, Maria!");
        expect(applyPlaceholders("Sra. {nome}", "maria da silva")).toBe("Sra. Maria da Silva");
    });
    it("usa o texto reserva quando o nome é desconhecido", () => {
        expect(applyPlaceholders("Oi, {primeironome|cliente}!", null)).toBe("Oi, cliente!");
    });
    it("sem nome e sem reserva, a variável some junto com a vírgula", () => {
        expect(applyPlaceholders("Oi, {primeironome}!", null)).toBe("Oi!");
    });
    it("não mexe em texto sem variáveis", () => {
        expect(applyPlaceholders("Promoção hoje", "Maria")).toBe("Promoção hoje");
    });
});

describe("hasPlaceholders", () => {
    it("detecta variáveis, repetidamente (regex global não pode reter estado)", () => {
        expect(hasPlaceholders("Oi {nome}")).toBe(true);
        expect(hasPlaceholders("Oi {nome}")).toBe(true);
        expect(hasPlaceholders("Oi")).toBe(false);
    });
});
