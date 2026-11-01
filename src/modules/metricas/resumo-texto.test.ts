import { describe, expect, it } from "vitest";
import { gerarResumoWhatsApp } from "./resumo-texto";
import type { VariacaoMetrica } from "./calcular";

const v = (atual: number, anterior: number, variacaoPct: number | null): VariacaoMetrica => ({ atual, anterior, variacaoPct });

const comparacao: Record<string, VariacaoMetrica> = {
    contatosNovos: v(112, 100, 12),
    clientesDeAnuncio: v(30, 0, null),
    reativados: v(4, 8, -50),
    tempoMedianoPrimeiraResposta: v(300, 600, -50),
    demandasSemRetorno: v(5, 5, 0),
};

const base = { negocio: "Salão Bela", mes: "outubro de 2026", vocabulario: { cliente: "paciente", clientes: "pacientes" }, comparacao };

describe("gerarResumoWhatsApp", () => {
    const texto = gerarResumoWhatsApp(base);

    it("traz negócio, mês e vocabulário informado", () => {
        expect(texto).toContain("Salão Bela");
        expect(texto).toContain("outubro de 2026");
        expect(texto).toMatch(/pacientes novos/i);
        expect(texto).not.toMatch(/clientes/i);
    });

    it("tem uma linha por âmbito com valor e variação", () => {
        expect(texto).toMatch(/pacientes novos: 112 \(\+12%\)/i);
        expect(texto).toMatch(/anúncio: 30 \(sem base de comparação\)/i);
        expect(texto).toMatch(/reativados: 4 \(-50%\)/i);
        expect(texto).toMatch(/primeira resposta: 5 min \(-50%\)/i);
        expect(texto).toMatch(/sem retorno: 5 \(sem mudança\)/i);
    });

    it("nunca imprime NaN nem 0% para variação nula", () => {
        expect(texto).not.toContain("NaN");
        expect(texto).not.toContain("null");
    });

    it("trata mediana zerada como sem dados", () => {
        const t = gerarResumoWhatsApp({ ...base, comparacao: { ...comparacao, tempoMedianoPrimeiraResposta: v(0, 0, null) } });
        expect(t).toMatch(/primeira resposta: sem dados/i);
    });

    it("tira telefone e JID que vierem no nome do negócio", () => {
        const t = gerarResumoWhatsApp({ ...base, negocio: "Salão 5561999990001@s.whatsapp.net (61) 99999-0001 Bela" });
        expect(t).not.toContain("@s.whatsapp.net");
        expect(t).not.toMatch(/\d{10,}/);
        expect(t).not.toMatch(/99999-0001/);
        expect(t).toContain("Salão");
        expect(t).toContain("Bela");
    });
    it("diz com o que comparou", () => {
        expect(gerarResumoWhatsApp({ ...base, comparadoCom: "setembro de 2026" })).toContain("Comparado com setembro de 2026.");
        expect(texto).toContain("Comparado com o período anterior de mesma duração.");
    });
    it("não vaza identificador de WhatsApp nem número de telefone", () => {
        const t = gerarResumoWhatsApp({ ...base, negocio: "Salão Bela" });
        expect(t).not.toContain("@s.whatsapp.net");
        expect(t).not.toMatch(/\d{10,}/);
    });
});
