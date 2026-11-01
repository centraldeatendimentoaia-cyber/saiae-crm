import { describe, expect, it } from "vitest";
import { dataBr, formatarDuracao, percentual, periodoAnterior, somarDias, mesAtual, mesCivilAnterior, mesPassado, nomeDoMes, rotuloPeriodo, ultimosDias, variacao } from "./formato";

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

describe("meses", () => {
    const hoje = new Date("2026-03-15T15:00:00Z");
    it("mês atual vai do dia 1 até hoje", () => expect(mesAtual(hoje)).toEqual({ de: "2026-03-01", ate: "2026-03-15" }));
    it("mês passado é inteiro, inclusive na virada do ano", () => {
        expect(mesPassado(hoje)).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
        expect(mesPassado(new Date("2026-01-05T15:00:00Z"))).toEqual({ de: "2025-12-01", ate: "2025-12-31" });
    });
    it("nomeia o mês em português", () => expect(nomeDoMes("2026-10-01")).toBe("outubro de 2026"));
    it("usa o dia de São Paulo na virada: 01/03 02:00 UTC ainda é fevereiro", () => {
        expect(mesAtual(new Date("2026-03-01T02:00:00Z"))).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
        expect(mesPassado(new Date("2026-03-01T02:00:00Z"))).toEqual({ de: "2026-01-01", ate: "2026-01-31" });
    });
    it("mês civil anterior ao mês de uma data", () => {
        expect(mesCivilAnterior("2026-11-01")).toEqual({ de: "2026-10-01", ate: "2026-10-31" });
        expect(mesCivilAnterior("2026-01-01")).toEqual({ de: "2025-12-01", ate: "2025-12-31" });
    });
    it("rótulo do período: mês inteiro, parcial ou intervalo livre", () => {
        expect(rotuloPeriodo({ de: "2026-10-01", ate: "2026-10-31" })).toEqual({ texto: "outubro de 2026", parcial: false });
        expect(rotuloPeriodo({ de: "2026-11-01", ate: "2026-11-12" })).toEqual({ texto: "1 a 12 de novembro de 2026 (parcial)", parcial: true });
        expect(rotuloPeriodo({ de: "2026-10-25", ate: "2026-11-03" })).toEqual({ texto: "25/10/2026 a 03/11/2026", parcial: true });
    });
});
