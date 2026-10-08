import { describe, it, expect } from "vitest";
import { normalizePhone, canonicalPhone, jidVariants, parseRecipients } from "./phone";

describe("normalizePhone", () => {
    it("acrescenta o DDI 55 em números brasileiros de 10 e 11 dígitos", () => {
        expect(normalizePhone("(61) 99953-1848")).toBe("5561999531848");
        expect(normalizePhone("6133445566")).toBe("556133445566");
    });
    it("mantém números que já têm DDI", () => {
        expect(normalizePhone("+55 61 99953-1848")).toBe("5561999531848");
    });
});

describe("canonicalPhone", () => {
    it("trata com e sem o 9º dígito como a mesma pessoa", () => {
        expect(canonicalPhone("5561999531848@s.whatsapp.net")).toBe(canonicalPhone("556199531848@s.whatsapp.net"));
    });
    it("ignora o sufixo de dispositivo do JID", () => {
        expect(canonicalPhone("5561999531848:12@s.whatsapp.net")).toBe("556199531848");
    });
    // Regressão: a regex era /D/g (letra D) em vez de /\D/g, então telefone formatado
    // (com +, espaços, parênteses ou traços) não era limpo nem igualado ao mesmo número sem formatação.
    it("limpa telefone formatado, não só JID", () => {
        expect(canonicalPhone("+55 61 99953-1848")).toBe("556199531848");
        expect(canonicalPhone("(61) 99953-1848")).toBe("61999531848");
    });
    it("telefone formatado e JID do mesmo número viram a mesma chave", () => {
        expect(canonicalPhone("+55 61 99953-1848")).toBe(canonicalPhone("5561999531848@s.whatsapp.net"));
    });
});

describe("jidVariants", () => {
    it("gera as duas formas de um número brasileiro de celular", () => {
        expect(jidVariants("5561999531848@s.whatsapp.net").sort()).toEqual(
            ["556199531848@s.whatsapp.net", "5561999531848@s.whatsapp.net"].sort()
        );
        expect(jidVariants("556199531848@s.whatsapp.net").sort()).toEqual(
            ["556199531848@s.whatsapp.net", "5561999531848@s.whatsapp.net"].sort()
        );
    });
    it("aceita texto com formatação, não só JID", () => {
        expect(jidVariants("+55 (61) 99953-1848").sort()).toEqual(
            ["556199531848@s.whatsapp.net", "5561999531848@s.whatsapp.net"].sort()
        );
    });
    it("não inventa variante para número estrangeiro", () => {
        expect(jidVariants("14155550123@s.whatsapp.net")).toEqual(["14155550123@s.whatsapp.net"]);
    });
});

describe("parseRecipients", () => {
    it("aceita linhas, vírgulas e ponto e vírgula", () => {
        const r = parseRecipients("(61) 99953-1848\n61 3344-5566, 61988887777; ");
        expect(r).toEqual([
            "5561999531848@s.whatsapp.net",
            "556133445566@s.whatsapp.net",
            "5561988887777@s.whatsapp.net",
        ]);
    });
    it("remove repetidos, inclusive com e sem o 9º dígito", () => {
        expect(parseRecipients("5561999531848\n556199531848\n61999531848")).toHaveLength(1);
    });
    it("descarta lixo e números fora do tamanho", () => {
        expect(parseRecipients("abc\n123\n\n9999999999999999")).toEqual([]);
    });
    it("preserva JIDs completos (grupos)", () => {
        expect(parseRecipients("120363123456789@g.us")).toEqual(["120363123456789@g.us"]);
    });
});
