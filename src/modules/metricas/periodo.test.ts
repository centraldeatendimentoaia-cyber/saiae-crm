import { describe, expect, it } from "vitest";
import { csvPorDia, expedienteDe, lerPeriodo } from "./periodo";
import { origemDe } from "./carregar";

describe("lerPeriodo", () => {
    it("aceita um período válido e converte para o fuso de São Paulo (inclusive nas duas pontas)", () => {
        const r = lerPeriodo({ de: "2026-10-12", ate: "2026-10-18" });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.periodo.dias).toBe(7);
        expect(r.periodo.inicio.toISOString()).toBe("2026-10-12T03:00:00.000Z");
        expect(r.periodo.fim.toISOString()).toBe("2026-10-19T02:59:59.999Z");
    });
    it("um único dia vale 1 dia", () => {
        const r = lerPeriodo({ de: "2026-10-12", ate: "2026-10-12" });
        expect(r.ok && r.periodo.dias).toBe(1);
    });
    it("exige as duas datas", () => {
        expect(lerPeriodo({ de: null, ate: "2026-10-12" })).toMatchObject({ ok: false, mensagem: expect.stringContaining("Informe o período") });
        expect(lerPeriodo({ de: "2026-10-12", ate: null }).ok).toBe(false);
    });
    it("rejeita formato errado e data que não existe", () => {
        expect(lerPeriodo({ de: "12/10/2026", ate: "2026-10-18" }).ok).toBe(false);
        expect(lerPeriodo({ de: "2026-02-30", ate: "2026-03-05" })).toMatchObject({ ok: false, mensagem: "Data inexistente." });
    });
    it("rejeita data final antes da inicial", () => {
        expect(lerPeriodo({ de: "2026-10-18", ate: "2026-10-12" })).toMatchObject({ ok: false, mensagem: expect.stringContaining("anterior") });
    });
    it("limita a 92 dias", () => {
        expect(lerPeriodo({ de: "2026-01-01", ate: "2026-04-02" }).ok).toBe(true); // 92 dias
        expect(lerPeriodo({ de: "2026-01-01", ate: "2026-04-03" })).toMatchObject({ ok: false, mensagem: expect.stringContaining("92") }); // 93 dias
    });
});

describe("expedienteDe", () => {
    it("sem configuração: segunda a sexta, 9h às 18h", () => {
        expect(expedienteDe(null)).toEqual({ dias: [1, 2, 3, 4, 5], horaAbre: 9, horaFecha: 18 });
    });
    it("lê o AgenteConfig da sessão", () => {
        expect(expedienteDe({ diasAbertos: "2,3,4,5,6", horaAbre: 8, horaFecha: 19 })).toEqual({ dias: [2, 3, 4, 5, 6], horaAbre: 8, horaFecha: 19 });
    });
    it("ignora lixo na lista de dias", () => {
        expect(expedienteDe({ diasAbertos: "1, x,9,3", horaAbre: 9, horaFecha: 18 }).dias).toEqual([1, 3]);
    });
});

describe("csvPorDia", () => {
    it("gera cabeçalho em português, separador ; e BOM, com tempo vazio quando não houve resposta", () => {
        const csv = csvPorDia([
            { dia: "2026-10-12", recebidas: 5, demandas: 3, semRetorno: 1, tempoMediano: 300 },
            { dia: "2026-10-13", recebidas: 0, demandas: 0, semRetorno: 0, tempoMediano: null },
        ]);
        expect(csv.startsWith("﻿")).toBe(true);
        expect(csv.split("\r\n")).toEqual([
            "﻿dia;mensagens_recebidas;demandas;sem_retorno;tempo_mediano_primeira_resposta_segundos",
            "2026-10-12;5;3;1;300",
            "2026-10-13;0;0;0;",
            "",
        ]);
    });
});

describe("origemDe", () => {
    const desde = new Date("2026-10-01T00:00:00Z");
    it("usa a origem registrada (ia/crm)", () => {
        expect(origemDe("ia", new Date("2026-09-01T00:00:00Z"), desde)).toBe("ia");
        expect(origemDe("crm", new Date("2026-10-05T00:00:00Z"), desde)).toBe("crm");
    });
    it("sem registro: humano depois da criação da tabela, desconhecido antes", () => {
        expect(origemDe(undefined, new Date("2026-10-05T00:00:00Z"), desde)).toBe("humano");
        expect(origemDe(undefined, new Date("2026-09-30T00:00:00Z"), desde)).toBe("desconhecido");
    });
    it("tabela ainda vazia: desconhecido", () => {
        expect(origemDe(undefined, new Date("2026-10-05T00:00:00Z"), null)).toBe("desconhecido");
    });
});
