import { describe, expect, it } from "vitest";
import { MODELOS } from "./modelos-prontos";
import { GATILHOS_PADRAO_IDS, LIMITE_BASE_TOTAL, LIMITE_EXEMPLOS, LIMITE_GATILHOS } from "./treino";
import {
    aplicarSugestao, atualizarEm, criarGuardaSessao, mensagemErroTreino, novoGatilho, novaBase, podeAdicionarGatilho, podeRemoverGatilho, removerEm, temAlteracoes, trocarDesfecho, validarTreino,
} from "./editor";
import { TreinoSchema } from "./treino";

describe("editor do treino", () => {
    it("removerEm e atualizarEm não mexem na lista original", () => {
        const l = [{ a: 1 }, { a: 2 }];
        expect(removerEm(l, 0)).toEqual([{ a: 2 }]);
        expect(atualizarEm(l, 1, { a: 9 })).toEqual([{ a: 1 }, { a: 9 }]);
        expect(l).toEqual([{ a: 1 }, { a: 2 }]);
    });
    it("gatilhos padrão não saem; extras saem", () => {
        expect(podeRemoverGatilho("desconto")).toBe(false);
        expect(podeRemoverGatilho("extra-1")).toBe(true);
    });
    it("novoGatilho gera id único e respeita o teto", () => {
        const t = MODELOS.branco;
        expect(novoGatilho(t.gatilhos).id).toBe("extra-1");
        expect(novoGatilho([...t.gatilhos, { id: "extra-1" }]).id).toBe("extra-2");
        const cheio = { ...t, gatilhos: Array.from({ length: LIMITE_GATILHOS }, (_, i) => ({ ...t.gatilhos[0], id: `g${i}` })) };
        expect(podeAdicionarGatilho(cheio)).toBe(false);
        expect(podeAdicionarGatilho(t)).toBe(true);
    });
    it("novaBase traz a data de hoje em AAAA-MM-DD", () => {
        expect(novaBase(new Date("2026-11-01T12:00:00Z")).atualizadoEm).toBe("2026-11-01");
    });
    it("validarTreino: null quando válido, mensagem PT-BR com o caminho quando não", () => {
        expect(validarTreino(MODELOS.salao)).toBeNull();
        const ruim = { ...MODELOS.branco, identidade: { ...MODELOS.branco.identidade, nome: "" } };
        expect(validarTreino(ruim)).toMatch(/^Treino inválido: .*\(identidade > nome\)$/);
        const r = TreinoSchema.safeParse({});
        expect(r.success).toBe(false);
        if (!r.success) expect(mensagemErroTreino(r.error)).toMatch(/^Treino inválido:/);
    });
    it("temAlteracoes compara o conteúdo", () => {
        expect(temAlteracoes(MODELOS.salao, structuredClone(MODELOS.salao))).toBe(false);
        expect(temAlteracoes({ ...MODELOS.salao, identidade: { ...MODELOS.salao.identidade, nome: "X" } }, MODELOS.salao)).toBe(true);
        expect(temAlteracoes(null, MODELOS.salao)).toBe(false);
    });
    it("trocarDesfecho descarta o link ao virar pessoa", () => {
        const t = trocarDesfecho(MODELOS.salao, "pessoa");
        expect(t.roteiro.desfecho).toEqual({ tipo: "pessoa" });
        expect(trocarDesfecho(t, "link", "https://x.com").roteiro.desfecho).toEqual({ tipo: "link", link: "https://x.com" });
    });
    it("recarregar durante uma ação não invalida a ação (a tela é liberada), mas a troca de sessão invalida", () => {
        const g = criarGuardaSessao();
        g.trocar("s1");
        const acao = g.iniciarAcao();
        const carga = g.iniciarCarga(); // publicar chama carregar()
        expect(g.cargaVigente(carga)).toBe(true);
        expect(acao.vigente()).toBe(true);
        g.iniciarCarga(); // outra recarga no meio
        expect(g.cargaVigente(carga)).toBe(false);
        expect(acao.vigente()).toBe(true);
        g.trocar("s2");
        expect(acao.vigente()).toBe(false);
        expect(g.cargaVigente(g.iniciarCarga())).toBe(true);
    });
    it("a lista de gatilhos padrão vem do schema", () => {
        expect(GATILHOS_PADRAO_IDS).toHaveLength(6);
        expect(podeRemoverGatilho(GATILHOS_PADRAO_IDS[0])).toBe(false);
    });
});

describe("aplicarSugestao", () => {
    const s = { cliente: "tem horário?", resposta: "Temos amanhã às 10h." };
    it("não muta o original e acrescenta exemplo ou base", () => {
        const t = JSON.parse(JSON.stringify(MODELOS.salao));
        const ex = aplicarSugestao(t, s, "exemplo");
        const ba = aplicarSugestao(t, s, "base", new Date("2026-11-01T12:00:00Z"));
        expect(typeof ex).not.toBe("string");
        expect((ex as typeof t).exemplos.at(-1)).toEqual({ cliente: s.cliente, ideal: s.resposta });
        expect((ba as typeof t).base.at(-1)).toEqual({ titulo: "Correção da equipe", texto: s.resposta, atualizadoEm: "2026-11-01" });
        expect(t).toEqual(MODELOS.salao);
    });
    it("passou do limite: devolve o problema em PT-BR", () => {
        const t = { ...MODELOS.salao, exemplos: Array.from({ length: LIMITE_EXEMPLOS }, () => ({ cliente: "c", ideal: "i" })) };
        expect(aplicarSugestao(t, s, "exemplo")).toMatch(/máximo/);
        const cheia = { ...MODELOS.salao, base: [{ titulo: "x", texto: "a".repeat(LIMITE_BASE_TOTAL), atualizadoEm: "2026-11-01" }] };
        expect(aplicarSugestao(cheia, s, "base")).toMatch(/máximo/);
    });
});
