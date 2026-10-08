import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import type { IaContextoAtivo } from "./comanda-contexto";
import { ehPerguntaAlimentar, MSG_ALIMENTAR_AVISADO, MSG_ALIMENTAR_SEM_AVISO, normalizar } from "./alimentar";
import type { EntradaLlm, Llm } from "./llm";
import { criarResponder } from "./motor";
import type { ConversaRef } from "./store";

describe("ehPerguntaAlimentar: dispara (com e sem acento, maiúsculas, erros comuns)", () => {
    it.each([
        "tenho alergia a leite",
        "TENHO ALERGIA GRAVE",
        "sou alérgico a amendoim",
        "sou alergico",
        "ela é alérgica a camarão",
        "alergias?",
        "sou intolerante à lactose",
        "intolerância ao glúten",
        "o açaí tem glúten?",
        "tem gluten",
        "GLUTEN",
        "sem lactose?",
        "tem lactose",
        "minha filha é celíaca",
        "celiaco",
        "é vegano?",
        "VEGANA",
        "tem opção vegetariana?",
        "tem traço de nozes?",
        "tem traços de amendoim",
        "tem traca de nozes",
        "posso comer isso?",
        "pode comer sem problema?",
        "quais os ingredientes?",
        "qual a composição do açaí",
        "do que é feito o açaí",
        "é sem açúcar?",
        "sem leite",
        "livre de glúten?",
        "sou diabético, pode?",
        "o açaí tem amendoim?",
        "tem nozes ou castanha?",
        "leva ovo?",
        "o açaí contém leite?",
        "  tem   AMENDOIM  ??  ",
    ])("%s", (t) => expect(ehPerguntaAlimentar(t)).toBe(true));
});

describe("ehPerguntaAlimentar: não dispara em pedido e perguntas comuns", () => {
    it.each([
        "quanto é o açaí de 500ml?",
        "quero um açaí com leite ninho",
        "tem leite ninho?",
        "tem leite condensado?",
        "quero com paçoca",
        "quero o açaí com amendoim e banana",
        "qual o horário de vocês?",
        "qual a taxa de entrega para Bela Vista?",
        "oi",
        "",
        "   ",
    ])("%j", (t) => expect(ehPerguntaAlimentar(t)).toBe(false));
    it("entrada inválida", () => {
        expect(ehPerguntaAlimentar(null)).toBe(false);
        expect(ehPerguntaAlimentar(undefined)).toBe(false);
    });
    it("normalizar tira acento, caixa e espaços", () => {
        expect(normalizar("  AlÉrgico   à  GLÚTEN ")).toBe("alergico a gluten");
    });
});

const ctx = {
    ativa: true,
    loja: { nome: "Açaí do Zé", endereco: null, aberta_agora: null, horarios: [], modos: [], pagamentos: [], taxa_entrega: { habilitada: false, padrao_centavos: null, bairro_nao_listado: "taxa_padrao", bairros: [] }, link_cardapio: "https://x.com/c/ABC234" },
    cardapio: { truncado: false, itens: [] },
    cliente: null,
    ia: { texto_livre: null, whatsapp_dono: "61988887777", plano_limite_conversas: null },
} as unknown as IaContextoAtivo;
const conversa: ConversaRef = { id: "c1", lojaCodigo: "ABC234", contactKey: "5511999990001", estado: "ia", pausadaAte: null };

function montar(chamarDono: () => Promise<boolean | "teto">, over: { limite?: () => Promise<"ok" | "so_link"> } = {}) {
    const entradas: EntradaLlm[] = [];
    const llm: Llm = { responder: async (e) => { entradas.push(e); return { texto: "O açaí custa R$ 22,00.", chamadas: [] }; } };
    const dono = vi.fn(chamarDono);
    const limite = vi.fn(over.limite ?? (async () => "ok" as const));
    const responder = criarResponder({
        llm,
        store: { historico: async () => [] },
        contexto: async () => ctx,
        acoes: () => ({ chamarDono: dono, registrarPergunta: async () => undefined }),
        limite,
        logger: { warn: vi.fn() },
    });
    return { dono, limite, entradas, rodar: (texto: string) => responder({ conversa, texto, nomePerfil: null, contactKey: conversa.contactKey }) };
}

describe("trava alimentar no motor (sem chamar o modelo)", () => {
    it("chama o responsável (assunto_sensivel) e devolve a resposta fixa de 'já avisei'", async () => {
        const m = montar(async () => true);
        expect(await m.rodar("sou alérgico a amendoim, o açaí tem?")).toBe(MSG_ALIMENTAR_AVISADO);
        expect(m.dono).toHaveBeenCalledWith("assunto_sensivel");
        expect(m.entradas).toHaveLength(0);
        expect(MSG_ALIMENTAR_AVISADO).toContain("Já avisei o responsável");
    });
    it("teto diário (pausou sem avisar): resposta fixa SEM dizer 'já avisei', sem garantia", async () => {
        const m = montar(async () => "teto");
        const r = await m.rodar("é vegano?");
        expect(r).toBe(MSG_ALIMENTAR_SEM_AVISO);
        expect(r).not.toMatch(/já avisei/i);
        expect(r).toMatch(/não consuma/i);
        expect(m.entradas).toHaveLength(0);
    });
    it("sem WhatsApp do responsável / falha: mesma resposta sem aviso, nunca garantia", async () => {
        for (const falha of [async () => false as const, async (): Promise<boolean> => { throw new Error("boom"); }]) {
            const m = montar(falha);
            expect(await m.rodar("tem glúten?")).toBe(MSG_ALIMENTAR_SEM_AVISO);
            expect(m.entradas).toHaveLength(0);
        }
    });
    it("as duas respostas fixas nunca afirmam ausência de alérgeno", () => {
        for (const t of [MSG_ALIMENTAR_AVISADO, MSG_ALIMENTAR_SEM_AVISO]) {
            expect(t).not.toMatch(/sem (gl[uú]ten|lactose|amendoim|nozes)|vegano|n[ãa]o (tem|cont[eé]m)|seguro|tranquil/i);
        }
    });
    it("a trava vem antes do limite do plano (não gasta contador) e pergunta comum segue para o modelo", async () => {
        const m = montar(async () => true);
        await m.rodar("tenho alergia");
        expect(m.limite).not.toHaveBeenCalled();
        expect(await m.rodar("quanto é o açaí?")).toBe("O açaí custa R$ 22,00.");
        expect(m.limite).toHaveBeenCalledTimes(1);
        expect(m.entradas).toHaveLength(1);
    });
    it("loja com IA inativa continua calada, mesmo em pergunta de alergia", async () => {
        const responder = criarResponder({
            llm: { responder: async () => ({ chamadas: [] }) },
            store: { historico: async () => [] },
            contexto: async () => ({ ativa: false }),
            acoes: () => ({ chamarDono: async () => true, registrarPergunta: async () => undefined }),
            logger: { warn: vi.fn() },
        });
        expect(await responder({ conversa, texto: "tenho alergia", nomePerfil: null, contactKey: conversa.contactKey })).toBeNull();
    });
});
