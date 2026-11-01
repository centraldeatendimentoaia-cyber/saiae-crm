import { describe, expect, it } from "vitest";
import { MODELOS } from "./modelos-prontos";
import { deveChamarPessoa } from "./gatilhos";
import type { Treino } from "./treino";

const gatilhos = (): Treino["gatilhos"] => MODELOS.branco.gatilhos.map((g) => ({ ...g }));
const desligar = (g: Treino["gatilhos"], id: string) => g.map((x) => (x.id === id ? { ...x, ativo: false } : x));
const chama = (texto: string, extra: Partial<Parameters<typeof deveChamarPessoa>[0]> = {}) =>
    deveChamarPessoa({ texto, mensagensSemAvancar: 0, gatilhos: gatilhos(), ...extra });

describe("deveChamarPessoa", () => {
    it("pedido explícito de humano chama", () => {
        const r = chama("quero falar com uma pessoa");
        expect(r).toMatchObject({ chamar: true, gatilhoId: "pedido-humano" });
        expect(r.frase).toBeTruthy();
    });

    it("gatilho desligado não chama", () => {
        expect(chama("quero falar com uma pessoa", { gatilhos: desligar(gatilhos(), "pedido-humano") }).chamar).toBe(false);
    });

    it("reclamação devolve a frase do gatilho de reclamação", () => {
        const g = gatilhos().map((x) => (x.id === "reclamacao" ? { ...x, frase: "Frase da reclamação" } : x));
        expect(chama("isso é um absurdo, vou no procon", { gatilhos: g })).toEqual({ chamar: true, gatilhoId: "reclamacao", frase: "Frase da reclamação" });
    });

    it("três mensagens sem avançar aciona a insistência; duas não", () => {
        expect(chama("ok", { mensagensSemAvancar: 3 })).toMatchObject({ chamar: true, gatilhoId: "sem-avanco" });
        expect(chama("ok", { mensagensSemAvancar: 2 }).chamar).toBe(false);
    });

    it("texto neutro e texto vazio não chamam", () => {
        expect(chama("Oi, queria marcar um horário amanhã").chamar).toBe(false);
        expect(chama("").chamar).toBe(false);
        expect(chama("   ").chamar).toBe(false);
    });

    it.each([
        ["pedido-humano", "me passa um atendente"],
        ["reclamacao", "atendimento péssimo"],
        ["assunto-sensivel", "estou grávida"],
        ["desconto", "dá um desconto especial?"],
    ])("gatilho %s desligado é ignorado", (id, texto) => {
        expect(chama(texto).gatilhoId).toBe(id);
        expect(chama(texto, { gatilhos: desligar(gatilhos(), id) }).chamar).toBe(false);
    });

    it("insistência desligada é ignorada", () => {
        expect(chama("ok", { mensagensSemAvancar: 5, gatilhos: desligar(gatilhos(), "sem-avanco") }).chamar).toBe(false);
    });

    it("ignora maiúsculas e acentos", () => {
        expect(chama("RECLAMAÇÃO").gatilhoId).toBe("reclamacao");
        expect(chama("reclamacao").gatilhoId).toBe("reclamacao");
        expect(chama("Quero falar com o GERENTE!!").gatilhoId).toBe("pedido-humano");
    });

    it("respeita fronteira de palavra", () => {
        expect(chama("vou ao procon").chamar).toBe(true);
        expect(chama("o proconsul chegou").chamar).toBe(false);
        expect(chama("sou desumano").chamar).toBe(false);
        expect(chama("processamento do pedido").chamar).toBe(false);
    });

    it("prioridade: sensível > reclamação > humano > desconto > insistência", () => {
        expect(chama("péssimo, quero um atendente, tenho alergia").gatilhoId).toBe("assunto-sensivel");
        expect(chama("péssimo, quero um atendente").gatilhoId).toBe("reclamacao");
        expect(chama("quero um atendente, desconto especial", { mensagensSemAvancar: 3 }).gatilhoId).toBe("pedido-humano");
        expect(chama("negociar desconto", { mensagensSemAvancar: 3 }).gatilhoId).toBe("desconto");
    });

    it("quando o de maior prioridade está desligado, cai para o seguinte", () => {
        const g = desligar(gatilhos(), "assunto-sensivel");
        expect(chama("péssimo, tenho alergia", { gatilhos: g }).gatilhoId).toBe("reclamacao");
    });

    describe("desconto", () => {
        it("com valorLimite, só chama se o número pedido passa do limite", () => {
            expect(chama("faz por 80 reais? tá mais barato lá", { valorLimite: 100 }).chamar).toBe(false);
            expect(chama("faz o desconto de 150", { valorLimite: 100 })).toMatchObject({ chamar: true, gatilhoId: "desconto" });
            expect(chama("desconto de 1.500,00", { valorLimite: 1000 }).chamar).toBe(true);
        });
        it("com valorLimite, pedido de desconto sem número não chama", () => {
            expect(chama("tem desconto?", { valorLimite: 100 }).chamar).toBe(false);
        });
        it("sem valorLimite, só frases de negociação explícita chamam", () => {
            expect(chama("tem desconto?").chamar).toBe(false);
            expect(chama("quero negociar o valor").chamar).toBe(true);
            expect(chama("aceita um desconto especial?").chamar).toBe(true);
        });
        it("número sem palavra de desconto não chama", () => {
            expect(chama("quero 200 unidades", { valorLimite: 100 }).chamar).toBe(false);
        });
    });

    it("gatilhos personalizados (sem lista de palavras) e áudio são ignorados aqui", () => {
        const g = [...gatilhos(), { id: "meu-extra", ativo: true, descricao: "qualquer coisa", frase: "x" }];
        expect(chama("qualquer coisa", { gatilhos: g }).chamar).toBe(false);
        expect(chama("áudio", { gatilhos: g }).chamar).toBe(false);
    });

    it("texto de 10 mil caracteres é rápido", () => {
        const t0 = Date.now();
        expect(chama("a ".repeat(5000) + "procon").chamar).toBe(true);
        expect(chama("1,".repeat(5000), { valorLimite: 5 }).chamar).toBe(false);
        expect(Date.now() - t0).toBeLessThan(500);
    });
});
