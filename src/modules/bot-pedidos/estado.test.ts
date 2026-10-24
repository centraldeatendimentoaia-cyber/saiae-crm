import { describe, expect, it } from "vitest";
import { criarEstadoBot, LIMITE_MINUTO, PAUSA_MS } from "./estado";

describe("estado do bot", () => {
    it("jaTratada marca e reconhece o messageId", () => {
        const e = criarEstadoBot();
        expect(e.jaTratada("s", "m1")).toBe(false);
        expect(e.jaTratada("s", "m1")).toBe(true);
    });
    it("pausa dura 12 h", () => {
        let t = 0;
        const e = criarEstadoBot(() => t);
        e.pausar("s", "c");
        expect(e.pausada("s", "c")).toBe(true);
        t = PAUSA_MS + 1;
        expect(e.pausada("s", "c")).toBe(false);
    });
    it("limite de 8 por minuto e 60 por hora", () => {
        let t = 0;
        const e = criarEstadoBot(() => t);
        const r = Array.from({ length: LIMITE_MINUTO + 1 }, () => e.estourouLimite("s", "c"));
        expect(r.slice(0, LIMITE_MINUTO).every((x) => !x)).toBe(true);
        expect(r[LIMITE_MINUTO]).toBe(true);
        let estourou = false;
        for (let i = 0; i < 61; i++) {
            t += 61_000; // uma por minuto: nunca estoura o minuto, estoura a hora
            estourou = e.estourouLimite("s", "outro");
        }
        expect(estourou).toBe(false); // 61 mensagens em ~61 min: a janela de 1 h segura no máximo 60
        const h = criarEstadoBot(() => t);
        let ultimo = false;
        for (let i = 0; i < 61; i++) {
            t += 50_000;
            ultimo = h.estourouLimite("s", "c");
        }
        expect(ultimo).toBe(true);
    });
    it("link do dia sai uma vez por contato e dia", () => {
        const e = criarEstadoBot();
        expect(e.primeiroLinkDoDia("s", "c", "2026-10-24")).toBe(true);
        expect(e.primeiroLinkDoDia("s", "c", "2026-10-24")).toBe(false);
        expect(e.primeiroLinkDoDia("s", "c", "2026-10-25")).toBe(true);
    });
});
