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
        expect(chama("atendimento péssimo, quero um atendente, tenho alergia").gatilhoId).toBe("assunto-sensivel");
        expect(chama("atendimento péssimo, quero um atendente").gatilhoId).toBe("reclamacao");
        expect(chama("quero um atendente, desconto especial", { mensagensSemAvancar: 3 }).gatilhoId).toBe("pedido-humano");
        expect(chama("negociar desconto", { mensagensSemAvancar: 3 }).gatilhoId).toBe("desconto");
    });

    it("quando o de maior prioridade está desligado, cai para o seguinte", () => {
        const g = desligar(gatilhos(), "assunto-sensivel");
        expect(chama("atendimento péssimo, tenho alergia", { gatilhos: g }).gatilhoId).toBe("reclamacao");
    });

    describe("desconto", () => {
        it("com valorLimite, compara só a porcentagem pedida", () => {
            expect(chama("faz um desconto de 15%", { valorLimite: 10 })).toMatchObject({ chamar: true, gatilhoId: "desconto" });
            expect(chama("desconto de 5%", { valorLimite: 10 }).chamar).toBe(false);
            expect(chama("desconto de 12,5 %", { valorLimite: 10 }).chamar).toBe(true);
        });
        it("datas, horas e valores em reais não contam como porcentagem", () => {
            expect(chama("tem desconto? queria dia 25 às 14h", { valorLimite: 10 }).chamar).toBe(false);
            expect(chama("faz por R$ 80? tá mais barato lá", { valorLimite: 10 }).chamar).toBe(false);
            expect(chama("desconto de 1.200,50 reais", { valorLimite: 10 }).chamar).toBe(false);
        });
        it("sem valorLimite, porcentagem sozinha não chama; negociação explícita chama", () => {
            expect(chama("tem desconto?").chamar).toBe(false);
            expect(chama("desconto de 50%").chamar).toBe(false);
            expect(chama("quero negociar o valor").chamar).toBe(true);
            expect(chama("aceita um desconto especial?").chamar).toBe(true);
        });
        it("negociação explícita chama mesmo com valorLimite", () => {
            expect(chama("quero uma condição especial", { valorLimite: 10 }).chamar).toBe(true);
        });
        it("porcentagem sem palavra de desconto não chama", () => {
            expect(chama("quero 50% de entrada", { valorLimite: 10 }).chamar).toBe(false);
        });
    });

    it("frases novas de pedido de humano", () => {
        for (const t of ["falar com a atendente", "quero falar com alguém", "falar com o dono", "uma pessoa de verdade", "não quero falar com robô", "não quero conversar com robo", "chama um atendente", "me passa para uma pessoa", "quero ser atendido por uma pessoa", "falar com a dona"])
            expect(chama(t).gatilhoId, t).toBe("pedido-humano");
        expect(chama("tem alguém aí?").chamar).toBe(false);
    });

    it("flexões de reclamação e assunto sensível", () => {
        for (const t of ["estou reclamando", "já reclamei", "reclamações", "fui enganado", "quero reembolso", "preciso de estorno", "nunca mais volto", "foi horrível", "estou decepcionado", "vocês são golpista", "vou processar", "pessimo atendimento", "serviço péssimo", "fui mal atendido"])
            expect(chama(t).gatilhoId, t).toBe("reclamacao");
        for (const t of ["vou chamar meus advogados", "processo judicial", "abrir processo", "vou entrar na justiça", "diagnóstico médico"])
            expect(chama(t).gatilhoId, t).toBe("assunto-sensivel");
    });

    it("conversa comercial normal não chama", () => {
        for (const t of ["meu cabelo está péssimo, quero hidratação", "qual o processo do procedimento?", "tratamento capilar", "queria um diagnóstico do meu cabelo"])
            expect(chama(t).chamar, t).toBe(false);
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
