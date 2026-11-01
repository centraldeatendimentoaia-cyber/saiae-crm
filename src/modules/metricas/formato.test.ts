import { describe, expect, it } from "vitest";
import { dataBr, formatarDuracao, percentual, periodoAnterior, somarDias, ultimosDias, variacao } from "./formato";

describe("formatarDuracao", () => {
    it("escolhe a unidade pelo tamanho", () => {
        expect(formatarDuracao(45)).toBe("45 s");
        expect(formatarDuracao(300)).toBe("5 min");
        expect(formatarDuracao(7800)).toBe("2 h 10 min");
        expect(formatarDuracao(7200)).toBe("2 h");
        expect(formatarDuracao(100_000)).toBe("1 d 3 h");
        expect(formatarDuracao(86_400)).toBe("1 d");
    });
    it("sem dado mostra traço", () => {
        expect(formatarDuracao(null)).toBe("—");
        expect(formatarDuracao(undefined)).toBe("—");
    });
});

describe("percentual e variacao", () => {
    it("percentual arredonda e não divide por zero", () => {
        expect(percentual(1, 3)).toBe(33);
        expect(percentual(0, 0)).toBeNull();
    });
    it("variação relativa e sentido", () => {
        expect(variacao(150, 100)).toEqual({ diferenca: 50, percentual: 50, sentido: "subiu" });
        expect(variacao(50, 100)).toEqual({ diferenca: -50, percentual: -50, sentido: "caiu" });
        expect(variacao(10, 10)).toEqual({ diferenca: 0, percentual: 0, sentido: "igual" });
        expect(variacao(5, 0)).toEqual({ diferenca: 5, percentual: null, sentido: "subiu" });
        expect(variacao(null, 10)).toBeNull();
        expect(variacao(10, null)).toBeNull();
    });
});

describe("datas", () => {
    it("últimos 7 dias terminam hoje (data de São Paulo, mesmo logo depois da meia-noite UTC)", () => {
        // 2026-10-13 01:30 UTC ainda é dia 12 em São Paulo
        expect(ultimosDias(7, new Date("2026-10-13T01:30:00Z"))).toEqual({ de: "2026-10-06", ate: "2026-10-12" });
        expect(ultimosDias(30, new Date("2026-10-13T12:00:00Z"))).toEqual({ de: "2026-09-14", ate: "2026-10-13" });
    });
    it("soma dias atravessando mês e ano", () => {
        expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
        expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
    });
    it("período anterior tem o mesmo tamanho e termina na véspera", () => {
        expect(periodoAnterior("2026-10-06", "2026-10-12")).toEqual({ de: "2026-09-29", ate: "2026-10-05" });
    });
    it("dataBr", () => {
        expect(dataBr("2026-10-12")).toBe("12/10/2026");
    });
});
