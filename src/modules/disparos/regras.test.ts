import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { RODAPE_SAIR, chaveDoCliente, dentroDaJanela, montarTextoCampanha, proximaJanela } from "./regras";

const sp = (iso: string) => Date.parse(`${iso}-03:00`);

describe("janela horária", () => {
    it("09:00 a 19:59 de São Paulo", () => {
        expect(dentroDaJanela(sp("2026-10-24T08:59:00"))).toBe(false);
        expect(dentroDaJanela(sp("2026-10-24T09:00:00"))).toBe(true);
        expect(dentroDaJanela(sp("2026-10-24T19:59:00"))).toBe(true);
        expect(dentroDaJanela(sp("2026-10-24T20:00:00"))).toBe(false);
    });
    it("próxima janela: depois das 20h vai para as 9h do dia seguinte; antes das 9h, para as 9h de hoje", () => {
        expect(proximaJanela(sp("2026-10-24T21:00:00"))).toBe(sp("2026-10-25T09:00:00"));
        expect(proximaJanela(sp("2026-10-24T07:00:00"))).toBe(sp("2026-10-24T09:00:00"));
        expect(proximaJanela(sp("2026-10-24T23:30:00"))).toBe(sp("2026-10-25T09:00:00"));
        expect(proximaJanela(sp("2026-10-24T00:10:00"))).toBe(sp("2026-10-24T09:00:00"));
    });
});

describe("montarTextoCampanha", () => {
    it("sem nome não deixa 'Oi !' e termina com o rodapé", () => {
        const t = montarTextoCampanha("Oi {nome}, tem promoção!", { nome: null, barraca: "X" });
        expect(t).not.toContain("Oi !");
        expect(t.startsWith("Oi, tem promoção!")).toBe(true);
        expect(t.endsWith(RODAPE_SAIR)).toBe(true);
    });
    it("preenche nome e barraca", () => {
        expect(montarTextoCampanha("Oi {nome}, venha na {barraca}", { nome: "Ana Souza", barraca: "Loja" })).toContain("Oi Ana, venha na Loja");
    });
    it("não duplica o rodapé escrito pelo dono", () => {
        const t = montarTextoCampanha(`Oferta!\n\n${RODAPE_SAIR}`, { nome: null, barraca: "X" });
        expect(t.split(RODAPE_SAIR).length - 1).toBe(1);
    });
});

describe("chaveDoCliente", () => {
    it("estável, 64 hex e muda com a loja", () => {
        const a = chaveDoCliente("loja-a", "5561999990001");
        expect(a).toMatch(/^[0-9a-f]{64}$/);
        expect(chaveDoCliente("loja-a", "5561999990001")).toBe(a);
        expect(chaveDoCliente("loja-b", "5561999990001")).not.toBe(a);
    });
});
