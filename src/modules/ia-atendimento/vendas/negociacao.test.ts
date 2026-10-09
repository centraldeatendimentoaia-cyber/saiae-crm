import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import type { EntradaLlm, Llm } from "../llm";
import type { ConversaRef } from "../store";
import { criarResponderVendas } from "./motor";
import { MSG_NEGOCIACAO_AVISADA, MSG_NEGOCIACAO_SEM_AVISO, pedeNegociacao } from "./negociacao";

describe("pedeNegociacao: dispara (com e sem acento, caixa)", () => {
    it.each([
        "faz 30% de desconto no Pro que eu fecho hoje",
        "tem DESCONTO?",
        "tem alguma promoção?",
        "tem promocao",
        "tem como ficar mais barato?",
        "tá caro, dá pra negociar?",
        "faz um abatimento?",
        "me dá um cupom",
        "tem cupom pra mim?",
        "tem alguma condição especial?",
        "preço especial pra mim",
        "fecha por 50?",
        "quero pagar menos",
        "tem como baixar o preço",
    ])("%s", (t) => expect(pedeNegociacao(t)).toBe(true));
});

describe("pedeNegociacao: não dispara", () => {
    it.each([
        "quanto custa o plano Essencial?",
        "tenho um negócio de açaí, serve pra mim?",
        "Oi! Quero ser testador do sai aê (vi no panfleto). Quantos dias grátis eu ganho?",
        "dá pra dar cupom de desconto pros meus clientes?",
        "o sistema tem cupom?",
        "como funciona o desconto do aplicativo?",
        "se eu der feedback do produto eu ganho dias grátis?",
        "",
        "   ",
    ])("%j", (t) => expect(pedeNegociacao(t)).toBe(false));
    it("entrada inválida", () => {
        expect(pedeNegociacao(null)).toBe(false);
        expect(pedeNegociacao(undefined)).toBe(false);
    });
});

const conversa: ConversaRef = { id: "v1", lojaCodigo: "VENDAS", contactKey: "5561999990001", estado: "ia", pausadaAte: null };

function montar(chamarHumano: () => Promise<boolean>) {
    const entradas: EntradaLlm[] = [];
    const llm: Llm = { responder: async (e) => { entradas.push(e); return { texto: "O Essencial custa R$ 57,90.", chamadas: [] }; } };
    const humano = vi.fn(chamarHumano);
    const limite = vi.fn(async () => "ok" as const);
    const responder = criarResponderVendas({ llm, store: { historico: async () => [] }, linkCadastro: "https://saiae.com.br/raio-x", chamarHumano: humano, limite, now: () => new Date("2026-10-12T17:35:00Z"), logger: { warn: vi.fn() } });
    return { entradas, humano, limite, rodar: (texto: string) => responder({ conversa, texto, nomePerfil: null, contactKey: conversa.contactKey }) };
}

describe("trava de negociação no vendedor (sem chamar o modelo)", () => {
    it("chama a equipe (negociacao) e devolve a resposta fixa, sem modelo e sem gastar contador", async () => {
        const m = montar(async () => true);
        expect(await m.rodar("faz 30% de desconto no Pro que eu fecho hoje")).toBe(MSG_NEGOCIACAO_AVISADA);
        expect(m.humano).toHaveBeenCalledWith(conversa, "negociacao", expect.any(String));
        expect(m.entradas).toHaveLength(0);
        expect(m.limite).not.toHaveBeenCalled();
    });
    it("equipe indisponível (falha ou exceção): resposta fixa sem 'já avisei', sem conceder nada", async () => {
        for (const falha of [async () => false, async (): Promise<boolean> => { throw new Error("boom"); }]) {
            const m = montar(falha);
            const r = await m.rodar("tem promoção?");
            expect(r).toBe(MSG_NEGOCIACAO_SEM_AVISO);
            expect(r).not.toMatch(/já avisei/i);
            expect(m.entradas).toHaveLength(0);
        }
    });
    it("as respostas fixas nunca concedem desconto nem citam valor", () => {
        for (const t of [MSG_NEGOCIACAO_AVISADA, MSG_NEGOCIACAO_SEM_AVISO]) expect(t).not.toMatch(/\d|R\$|%|grátis|claro|combinado/i);
    });
    it("pergunta comum e pergunta do recurso de cupom seguem para o modelo", async () => {
        const m = montar(async () => true);
        expect(await m.rodar("quanto custa o Essencial?")).toBe("O Essencial custa R$ 57,90.");
        await m.rodar("dá pra dar cupom de desconto pros meus clientes?");
        expect(m.entradas).toHaveLength(2);
        expect(m.humano).not.toHaveBeenCalled();
    });
});
