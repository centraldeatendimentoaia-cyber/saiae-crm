import { describe, expect, it } from "vitest";
import { calcularMetricas, estatisticaTempo, type MsgMetrica, type OrigemResposta } from "./calcular";

// São Paulo é UTC-3 o ano todo (sem horário de verão desde 2019).
// 2026-10-12 é segunda-feira.
const sp = (iso: string) => new Date(`${iso}-03:00`);
const EXP = { dias: [1, 2, 3, 4, 5], horaAbre: 9, horaFecha: 18 };
const PERIODO = { inicio: sp("2026-10-12T00:00:00"), fim: sp("2026-10-18T23:59:59"), expediente: EXP };

const rec = (contato: string, quando: string): MsgMetrica => ({ contato, fromMe: false, timestamp: sp(quando), origem: "desconhecido" });
const env = (contato: string, quando: string, origem: OrigemResposta = "humano"): MsgMetrica => ({ contato, fromMe: true, timestamp: sp(quando), origem });

const A = "5561999990001@s.whatsapp.net";
const B = "5561999990002@s.whatsapp.net";
const C = "5561999990003@s.whatsapp.net";
const D = "5561999990004@s.whatsapp.net";

describe("demanda simples", () => {
    it("uma pergunta e uma resposta em 5 minutos, dentro do expediente", () => {
        const r = calcularMetricas([rec(A, "2026-10-12T10:00:00"), env(A, "2026-10-12T10:05:00")], PERIODO);
        expect(r.mensagensRecebidas).toBe(1);
        expect(r.mensagensEnviadas).toBe(1);
        expect(r.contatosUnicos).toBe(1);
        expect(r.demandas).toBe(1);
        expect(r.demandasForaExpediente).toBe(0);
        expect(r.demandasSemRetorno).toBe(0);
        expect(r.demandasPendentes).toBe(0);
        expect(r.tempoPrimeiraResposta.geral).toEqual({ media: 300, mediana: 300, p90: 300, amostras: 1 });
        expect(r.tempoPrimeiraResposta.dentroExpediente.mediana).toBe(300);
        expect(r.tempoPrimeiraResposta.foraExpediente.amostras).toBe(0);
    });
    it("nova mensagem depois da resposta abre outra demanda; a primeira resposta é só a primeira", () => {
        const r = calcularMetricas(
            [rec(A, "2026-10-12T10:00:00"), env(A, "2026-10-12T10:01:00"), env(A, "2026-10-12T10:02:00"), rec(A, "2026-10-12T11:00:00"), env(A, "2026-10-12T11:10:00")],
            PERIODO
        );
        expect(r.demandas).toBe(2);
        expect(r.mensagensEnviadas).toBe(3);
        expect(r.tempoPrimeiraResposta.geral.amostras).toBe(2);
        expect(r.tempoPrimeiraResposta.geral.media).toBe(330); // (60 + 600) / 2
    });
});

describe("várias mensagens seguidas", () => {
    it("recebidas sem resposta no meio são uma demanda só, contada desde a primeira", () => {
        const r = calcularMetricas([rec(A, "2026-10-12T10:00:00"), rec(A, "2026-10-12T10:01:00"), rec(A, "2026-10-12T10:02:00"), env(A, "2026-10-12T10:10:00")], PERIODO);
        expect(r.mensagensRecebidas).toBe(3);
        expect(r.demandas).toBe(1);
        expect(r.tempoPrimeiraResposta.geral.mediana).toBe(600);
    });
    it("mensagem nossa sem pergunta antes não cria demanda", () => {
        const r = calcularMetricas([env(A, "2026-10-12T10:00:00")], PERIODO);
        expect(r.demandas).toBe(0);
        expect(r.mensagensEnviadas).toBe(1);
    });
    it("a ordem da lista de entrada não importa", () => {
        const r = calcularMetricas([env(A, "2026-10-12T10:10:00"), rec(A, "2026-10-12T10:02:00"), rec(A, "2026-10-12T10:00:00")], PERIODO);
        expect(r.demandas).toBe(1);
        expect(r.tempoPrimeiraResposta.geral.mediana).toBe(600);
    });
});

describe("fora do expediente", () => {
    it("demanda iniciada à noite conta como fora e o tempo vai para o grupo de fora", () => {
        const r = calcularMetricas([rec(A, "2026-10-12T22:00:00"), env(A, "2026-10-13T09:30:00")], PERIODO);
        expect(r.demandasForaExpediente).toBe(1);
        expect(r.tempoPrimeiraResposta.foraExpediente.mediana).toBe(11.5 * 3600);
        expect(r.tempoPrimeiraResposta.dentroExpediente.amostras).toBe(0);
    });
    it("fim de semana e a hora de fechar (18h em ponto) são fora; a hora de abrir (9h) é dentro", () => {
        const r = calcularMetricas([rec(A, "2026-10-17T10:00:00"), rec(B, "2026-10-12T18:00:00"), rec(C, "2026-10-12T09:00:00")], PERIODO);
        expect(r.demandas).toBe(3);
        expect(r.demandasForaExpediente).toBe(2);
    });
});

describe("sem retorno x pendente", () => {
    it("sem resposta e prazo vencido = sem retorno; prazo ainda aberto no fim do período = pendente", () => {
        const r = calcularMetricas([rec(A, "2026-10-12T10:00:00"), rec(B, "2026-10-18T20:00:00")], PERIODO);
        expect(r.demandasSemRetorno).toBe(1);
        expect(r.demandasPendentes).toBe(1);
        expect(r.demandas).toBe(2);
    });
    it("resposta depois do prazo também é sem retorno, mas entra no tempo de resposta", () => {
        const r = calcularMetricas([rec(A, "2026-10-12T10:00:00"), env(A, "2026-10-14T10:00:00")], PERIODO);
        expect(r.demandasSemRetorno).toBe(1);
        expect(r.tempoPrimeiraResposta.geral.mediana).toBe(48 * 3600);
    });
    it("horasSemRetorno é configurável", () => {
        const msgs = [rec(A, "2026-10-12T10:00:00")];
        const curto = { inicio: sp("2026-10-12T00:00:00"), fim: sp("2026-10-12T12:00:00"), expediente: EXP };
        expect(calcularMetricas(msgs, { ...curto, horasSemRetorno: 1 }).demandasSemRetorno).toBe(1);
        expect(calcularMetricas(msgs, { ...curto, horasSemRetorno: 24 }).demandasPendentes).toBe(1);
    });
    it("resposta depois do fim do período não conta (o relatório termina no fim)", () => {
        const curto = { inicio: sp("2026-10-12T00:00:00"), fim: sp("2026-10-12T12:00:00"), expediente: EXP };
        const r = calcularMetricas([rec(A, "2026-10-12T10:00:00"), env(A, "2026-10-12T15:00:00")], curto);
        expect(r.demandasPendentes).toBe(1);
        expect(r.tempoPrimeiraResposta.geral.amostras).toBe(0);
    });
});

describe("virada de dia e fuso", () => {
    it("23h30 em São Paulo (02h30 UTC do dia seguinte) pertence ao dia local", () => {
        const r = calcularMetricas([rec(A, "2026-10-12T23:30:00")], PERIODO);
        expect(r.porDia.find((d) => d.dia === "2026-10-12")?.recebidas).toBe(1);
        expect(r.porDia.find((d) => d.dia === "2026-10-13")?.recebidas).toBe(0);
        expect(r.volumePorDiaHora[1][23]).toBe(1); // segunda-feira, 23h
    });
    it("demanda que começa num dia e é respondida no outro fica no dia de início", () => {
        const r = calcularMetricas([rec(A, "2026-10-12T23:50:00"), env(A, "2026-10-13T00:20:00")], PERIODO);
        const dia12 = r.porDia.find((d) => d.dia === "2026-10-12")!;
        expect(dia12.demandas).toBe(1);
        expect(dia12.tempoMediano).toBe(1800);
        expect(r.porDia.find((d) => d.dia === "2026-10-13")!.demandas).toBe(0);
    });
    it("pergunta do dia anterior ao período, já respondida, não vira demanda do período; a seguinte vira", () => {
        const r = calcularMetricas([rec(A, "2026-10-11T23:00:00"), env(A, "2026-10-11T23:30:00"), rec(A, "2026-10-12T09:00:00")], PERIODO);
        expect(r.demandas).toBe(1);
        expect(r.mensagensRecebidas).toBe(1);
    });
    it("mensagens seguidas que atravessam o início do período são a mesma demanda, que pertence ao período anterior", () => {
        const r = calcularMetricas([rec(A, "2026-10-11T23:50:00"), rec(A, "2026-10-12T00:10:00"), env(A, "2026-10-12T09:00:00")], PERIODO);
        expect(r.demandas).toBe(0);
        expect(r.mensagensRecebidas).toBe(1);
    });
    it("a série diária traz todos os dias do período, inclusive os vazios", () => {
        const r = calcularMetricas([], PERIODO);
        expect(r.porDia.map((d) => d.dia)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
        expect(r.volumePorDiaHora).toHaveLength(7);
        expect(r.volumePorDiaHora.every((l) => l.length === 24)).toBe(true);
    });
});

describe("contatos ignorados", () => {
    it("grupos, status, listas de transmissão e canais não entram em nada", () => {
        const ignorados = ["1203630000@g.us", "status@broadcast", "5561999@broadcast", "1203@newsletter"];
        const r = calcularMetricas(ignorados.flatMap((c) => [rec(c, "2026-10-12T10:00:00"), env(c, "2026-10-12T10:05:00")]), PERIODO);
        expect(r.mensagensRecebidas).toBe(0);
        expect(r.mensagensEnviadas).toBe(0);
        expect(r.contatosUnicos).toBe(0);
        expect(r.demandas).toBe(0);
    });
});

describe("contatos novos e únicos", () => {
    it("novo = primeira mensagem do contato dentro do período", () => {
        const r = calcularMetricas([rec(A, "2026-10-11T10:00:00"), rec(A, "2026-10-12T10:00:00"), rec(B, "2026-10-12T11:00:00")], PERIODO);
        expect(r.contatosUnicos).toBe(2);
        expect(r.contatosNovos).toBe(1);
    });
});

describe("origem das respostas", () => {
    it("conta a origem só da primeira resposta de cada demanda", () => {
        const r = calcularMetricas(
            [
                rec(A, "2026-10-12T10:00:00"), env(A, "2026-10-12T10:01:00", "ia"), env(A, "2026-10-12T10:30:00", "humano"),
                rec(B, "2026-10-12T11:00:00"), env(B, "2026-10-12T11:20:00", "humano"),
                rec(C, "2026-10-12T12:00:00"), env(C, "2026-10-12T12:05:00", "crm"),
                rec(D, "2026-10-12T13:00:00"), env(D, "2026-10-12T13:05:00", "desconhecido"),
            ],
            PERIODO
        );
        expect(r.respostasPorOrigem).toEqual({ ia: 1, humano: 1, crm: 1, desconhecido: 1 });
    });
});

describe("estatisticaTempo", () => {
    it("média, mediana (par e ímpar) e p90 pelo posto mais próximo", () => {
        expect(estatisticaTempo([])).toEqual({ media: null, mediana: null, p90: null, amostras: 0 });
        expect(estatisticaTempo([10, 20, 30])).toEqual({ media: 20, mediana: 20, p90: 30, amostras: 3 });
        expect(estatisticaTempo([10, 20, 30, 40])).toMatchObject({ mediana: 25 });
        const dez = Array.from({ length: 10 }, (_, i) => (i + 1) * 10);
        expect(estatisticaTempo(dez).p90).toBe(90);
    });
});
