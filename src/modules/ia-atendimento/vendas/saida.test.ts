import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import type { Llm } from "../llm";
import type { ConversaRef } from "../store";
import { criarResponderVendas } from "./motor";
import { MSG_SAIDA_SEGURA, pedeDadoSensivel, protegerSaida } from "./saida";

describe("pedeDadoSensivel: pega pedido de dado sensível ou cobrança", () => {
    it.each([
        "Me passe o número do seu cartão para eu abrir a conta.",
        "Pode me enviar seu CPF?",
        "Informe a senha que você usa.",
        "Qual é o seu CVV?",
        "Preciso do seu CPF e CNPJ para abrir sua conta.",
        "Digite o código de verificação que chegou no seu celular.",
        "Me manda o token de acesso.",
        "Pague pela chave pix 12345678000199 e eu libero.",
        "Faça um pix para ativar o plano.",
        "Qual a sua senha atual?",
        "Compartilhe os dados do cartão aqui mesmo.",
        "ME PASSE O NÚMERO DO CARTÃO",
    ])("%s", (t) => expect(pedeDadoSensivel(t)).toBe(true));
});

describe("pedeDadoSensivel: não pega recusa nem fluxo normal de cadastro", () => {
    it.each([
        "Eu nunca peço senha, cartão ou CPF por aqui.",
        "Não precisa informar CPF nem cartão: o cadastro é pelo link.",
        "Você vai criar uma senha na hora de se cadastrar pelo link oficial.",
        "Para começar, cadastre-se em https://saiae.com.br/raio-x e crie sua conta com e-mail e senha.",
        "Não envie senha nem cartão por aqui, ok?",
        "O Essencial custa R$ 57,90 por mês e aceita Pix, débito e crédito.",
        "A loja recebe pagamento por Pix pelo cardápio digital.",
        "Seu teste grátis é de 30 dias do plano Essencial.",
        "Evite compartilhar sua senha com qualquer pessoa.",
        "",
    ])("%s", (t) => expect(pedeDadoSensivel(t)).toBe(false));
    it("entrada inválida", () => {
        expect(pedeDadoSensivel(null)).toBe(false);
        expect(pedeDadoSensivel(undefined)).toBe(false);
    });
});

describe("protegerSaida e a frase fixa", () => {
    it("troca a resposta que pede dado; mantém a normal", () => {
        expect(protegerSaida("Me passe o número do seu cartão.")).toEqual({ texto: MSG_SAIDA_SEGURA, trocada: true });
        expect(protegerSaida("O Essencial custa R$ 57,90.")).toEqual({ texto: "O Essencial custa R$ 57,90.", trocada: false });
    });
    it("a frase fixa não se pede nada e não é ela mesma barrada", () => {
        expect(pedeDadoSensivel(MSG_SAIDA_SEGURA)).toBe(false);
        expect(MSG_SAIDA_SEGURA).not.toMatch(/https?:|\d/);
    });
});

const conversa: ConversaRef = { id: "v1", lojaCodigo: "VENDAS", contactKey: "5561999990001", estado: "ia", pausadaAte: null };

describe("trava de saída no motor de vendas", () => {
    const montar = (texto: string) => {
        const llm: Llm = { responder: async () => ({ texto, chamadas: [] }) };
        const logger = { warn: vi.fn() };
        const responder = criarResponderVendas({ llm, store: { historico: async () => [] }, linkCadastro: "https://saiae.com.br/raio-x", chamarHumano: async () => true, now: () => new Date("2026-10-12T17:35:00Z"), logger });
        return { logger, rodar: () => responder({ conversa, texto: "pode abrir minha conta?", nomePerfil: null, contactKey: conversa.contactKey }) };
    };
    it("resposta do modelo que pede cartão/CPF vira a frase segura, com aviso no log sem conteúdo", async () => {
        const m = montar("Claro! Me passe seu CPF e o número do cartão.");
        expect(await m.rodar()).toBe(MSG_SAIDA_SEGURA);
        const log = JSON.stringify(m.logger.warn.mock.calls);
        expect(log).toContain("trocada");
        expect(log).not.toMatch(/cpf|cartão|cartao/i);
    });
    it("resposta normal passa intacta", async () => {
        const m = montar("O Essencial custa R$ 57,90 por mês.");
        expect(await m.rodar()).toBe("O Essencial custa R$ 57,90 por mês.");
    });
});
