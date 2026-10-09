import { describe, expect, it } from "vitest";
import { anonimizarTexto, formatarConversa } from "./anonimizar";

describe("anonimizarTexto", () => {
    it("troca telefone, CPF e CNPJ, mas mantém os números públicos do Saiaê", () => {
        expect(anonimizarTexto("meu zap é (61) 99123-4567")).toBe("meu zap é [NÚMERO]");
        expect(anonimizarTexto("+55 11 98888-7777 e 123.456.789-09")).toBe("[NÚMERO] e [NÚMERO]");
        expect(anonimizarTexto("CNPJ 12.345.678/0001-90")).toBe("CNPJ [NÚMERO]");
        expect(anonimizarTexto("Suporte: (61) 98269-4384")).toBe("Suporte: (61) 98269-4384");
    });
    it("não mexe em preços, dias e horas", () => {
        const t = "O Essencial custa R$ 57,90, 30 dias, das 9h às 18h.";
        expect(anonimizarTexto(t)).toBe(t);
    });
    it("troca e-mail e links de fora, mas mantém o link do Saiaê", () => {
        expect(anonimizarTexto("me chama em ana@loja.com")).toBe("me chama em [EMAIL]");
        expect(anonimizarTexto("veja https://instagram.com/minhaloja")).toBe("veja [LINK]");
        expect(anonimizarTexto("cadastre em https://saiae.com.br/raio-x")).toBe("cadastre em https://saiae.com.br/raio-x");
    });
    it("troca o nome quando a pessoa se apresenta", () => {
        expect(anonimizarTexto("Oi, meu nome é Carlos Silva e tenho uma barraca")).toBe("Oi, meu nome é [NOME] e tenho uma barraca");
        expect(anonimizarTexto("sou a Maria da Barraca do Zé")).toContain("sou a [NOME]");
    });
});

describe("formatarConversa", () => {
    it("usa só Cliente e Atendente, sem telefone nem nome de perfil", () => {
        const out = formatarConversa(3, [
            { direcao: "in", texto: "oi, ligue 61 99123-4567", criadoEm: new Date("2026-10-13T12:00:00Z") },
            { direcao: "out", texto: "Oi! Sou o atendente IA do Sai aê.\nComo posso ajudar?", criadoEm: new Date("2026-10-13T12:01:00Z") },
        ]);
        expect(out).toContain("=== Conversa 3 (2 mensagens) ===");
        expect(out).toContain("Cliente: oi, ligue [NÚMERO]");
        expect(out).toContain("Atendente: Oi! Sou o atendente IA do Sai aê. ⏎ Como posso ajudar?");
        expect(out).not.toMatch(/\d{8,}/);
    });
});
