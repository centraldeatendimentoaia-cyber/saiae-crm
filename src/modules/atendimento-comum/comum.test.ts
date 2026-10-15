import { describe, it, expect } from "vitest";
import { iaPausada, dadosPausar, dadosRetomar, ESTADO_HUMANO, ESTADO_IA } from "./pausa";
import { diaSaoPaulo, diaEHora } from "./tempo";

const agora = new Date("2026-03-10T15:00:00Z");
const depois = new Date("2026-03-10T16:00:00Z");
const antes = new Date("2026-03-10T14:00:00Z");

describe("iaPausada", () => {
    it("so cala a IA quando uma pessoa assumiu e a pausa nao venceu", () => {
        expect(iaPausada({ estado: ESTADO_HUMANO, pausadaAte: depois }, agora)).toBe(true);
        expect(iaPausada({ estado: ESTADO_HUMANO, pausadaAte: antes }, agora)).toBe(false);
        expect(iaPausada({ estado: ESTADO_HUMANO, pausadaAte: agora }, agora)).toBe(false);
        expect(iaPausada({ estado: ESTADO_HUMANO, pausadaAte: null }, agora)).toBe(false);
        expect(iaPausada({ estado: ESTADO_IA, pausadaAte: depois }, agora)).toBe(false);
    });
});

describe("dadosPausar / dadosRetomar", () => {
    it("monta os campos de pausa e retomada, preservando os extras", () => {
        expect(dadosPausar(depois)).toEqual({ estado: "humano", pausadaAte: depois });
        expect(dadosPausar(depois, { motivoPausa: "reclamacao" })).toEqual({ estado: "humano", pausadaAte: depois, motivoPausa: "reclamacao" });
        expect(dadosRetomar()).toEqual({ estado: "ia", pausadaAte: null });
        expect(dadosRetomar({ motivoPausa: null })).toEqual({ estado: "ia", pausadaAte: null, motivoPausa: null });
    });

    it("uma conversa pausada com dadosPausar fica calada e volta com dadosRetomar", () => {
        expect(iaPausada(dadosPausar(depois), agora)).toBe(true);
        expect(iaPausada(dadosRetomar(), agora)).toBe(false);
    });
});

describe("fuso de Sao Paulo", () => {
    it("diaSaoPaulo usa o dia local, nao o UTC", () => {
        expect(diaSaoPaulo(new Date("2026-03-11T01:30:00Z"))).toBe("2026-03-10"); // 22:30 em SP
        expect(diaSaoPaulo(new Date("2026-03-11T03:00:00Z"))).toBe("2026-03-11");
    });

    it("diaEHora devolve dia da semana (0 = domingo) e hora em Brasilia", () => {
        expect(diaEHora(new Date("2026-03-10T15:00:00Z"))).toEqual({ dia: 2, hora: 12 }); // terca, 12h
        expect(diaEHora(new Date("2026-03-08T12:00:00Z"))).toEqual({ dia: 0, hora: 9 }); // domingo, 9h
    });
});
