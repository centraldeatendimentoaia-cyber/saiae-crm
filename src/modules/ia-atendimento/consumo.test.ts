import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import type { IaContextoAtivo } from "./comanda-contexto";
import { criarControleLimite, limiteConhecido, limparLimitesParaTeste, mesSaoPaulo, type ConsumoStore } from "./consumo";
import { criarResponder, mensagemSoLink } from "./motor";
import type { ConversaRef } from "./store";

const conversa: ConversaRef = { id: "c1", lojaCodigo: "ABC234", contactKey: "5511999990001", estado: "ia", pausadaAte: null };
const ctx = (limite: number | null) =>
    ({ ativa: true, loja: { nome: "Açaí do Zé", link_cardapio: "https://x.com/c/ABC234" }, ia: { texto_livre: null, whatsapp_dono: "61988887777", plano_limite_conversas: limite } }) as unknown as IaContextoAtivo;

const completo = (limite: number | null) =>
    ({
        ativa: true,
        loja: { nome: "Açaí do Zé", endereco: null, aberta_agora: null, horarios: [], modos: [], pagamentos: [], taxa_entrega: { habilitada: false, padrao_centavos: null, bairro_nao_listado: "taxa_padrao", bairros: [] }, link_cardapio: "https://x.com/c/ABC234" },
        cardapio: { truncado: false, itens: [] },
        cliente: null,
        ia: { texto_livre: null, whatsapp_dono: null, plano_limite_conversas: limite },
    }) as IaContextoAtivo;

function memConsumo(nova = true, inicial = 0) {
    let total = inicial;
    const store: ConsumoStore = {
        conversaNova: vi.fn(async () => nova),
        incrementar: vi.fn(async () => ++total),
        ler: vi.fn(async () => total),
    };
    return store;
}

beforeEach(() => limparLimitesParaTeste());

describe("mesSaoPaulo", () => {
    it("usa o fuso de São Paulo na virada do mês", () => {
        expect(mesSaoPaulo(new Date("2026-11-01T02:30:00Z"))).toBe("2026-10"); // ainda 31/10 em SP
        expect(mesSaoPaulo(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11");
        expect(mesSaoPaulo(new Date("2026-10-08T12:00:00Z"))).toBe("2026-10");
    });
});

describe("controle de limite", () => {
    it("sem limite (null): sempre ok, mas conta", async () => {
        const store = memConsumo();
        const avisarDono = vi.fn(async () => undefined);
        const c = criarControleLimite({ store, avisarDono });
        expect(await c(conversa, ctx(null))).toBe("ok");
        expect(store.incrementar).toHaveBeenCalledWith("ABC234", expect.stringMatching(/^\d{4}-\d{2}$/));
        expect(avisarDono).not.toHaveBeenCalled();
    });
    it("dentro do limite: ok; ao passar: só link e avisa o dono UMA vez no mês", async () => {
        const store = memConsumo(true, 1);
        const avisarDono = vi.fn(async () => undefined);
        const c = criarControleLimite({ store, avisarDono });
        expect(await c(conversa, ctx(2))).toBe("ok"); // 2 de 2
        expect(await c(conversa, ctx(2))).toBe("so_link"); // 3 de 2
        expect(await c(conversa, ctx(2))).toBe("so_link"); // 4 de 2
        expect(avisarDono).toHaveBeenCalledTimes(1);
    });
    it("mensagem de conversa em andamento não conta de novo", async () => {
        const store = memConsumo(false, 5);
        const c = criarControleLimite({ store, avisarDono: async () => undefined });
        expect(await c(conversa, ctx(10))).toBe("ok");
        expect(store.incrementar).not.toHaveBeenCalled();
        expect(store.ler).toHaveBeenCalled();
    });
    it("limite 0 = só link", async () => {
        expect(await criarControleLimite({ store: memConsumo(), avisarDono: async () => undefined })(conversa, ctx(0))).toBe("so_link");
    });
    it("lembra o último limite visto por loja", async () => {
        const c = criarControleLimite({ store: memConsumo(), avisarDono: async () => undefined });
        expect(limiteConhecido("ABC234")).toBeNull();
        await c(conversa, ctx(300));
        expect(limiteConhecido("ABC234")).toBe(300);
        await c(conversa, ctx(null));
        expect(limiteConhecido("ABC234")).toBeNull();
    });
    it("falha na contagem não silencia a IA e não vaza o texto do erro", async () => {
        const logger = { warn: vi.fn() };
        const store: ConsumoStore = { conversaNova: async () => { throw new Error("db caiu 5511999990001"); }, incrementar: async () => 0, ler: async () => 0 };
        expect(await criarControleLimite({ store, avisarDono: async () => undefined, logger })(conversa, ctx(1))).toBe("ok");
        expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("5511999990001");
    });
    it("falha ao avisar o dono não impede o modo só link", async () => {
        const c = criarControleLimite({ store: memConsumo(true, 5), avisarDono: async () => { throw new Error("x"); }, logger: { warn: vi.fn() } });
        expect(await c(conversa, ctx(1))).toBe("so_link");
    });
});

describe("motor com limite", () => {
    const montar = (decisao: "ok" | "so_link") => {
        const llm = { responder: vi.fn(async () => ({ texto: "resposta do modelo", chamadas: [] })) };
        const responder = criarResponder({
            llm,
            store: { historico: async () => [{ direcao: "in" as const, texto: "oi" }] },
            contexto: async () => completo(10),
            acoes: () => ({ chamarDono: async () => true, registrarPergunta: async () => undefined }),
            limite: async () => decisao,
            logger: { warn: vi.fn() },
        });
        return { llm, responder };
    };
    it("so_link: manda o link e NÃO chama o modelo", async () => {
        const { llm, responder } = montar("so_link");
        expect(await responder({ conversa, texto: "oi", nomePerfil: null, contactKey: conversa.contactKey })).toBe(mensagemSoLink("https://x.com/c/ABC234"));
        expect(llm.responder).not.toHaveBeenCalled();
    });
    it("ok: segue para o modelo", async () => {
        const { llm, responder } = montar("ok");
        expect(await responder({ conversa, texto: "oi", nomePerfil: null, contactKey: conversa.contactKey })).toBe("resposta do modelo");
        expect(llm.responder).toHaveBeenCalledTimes(1);
    });
});
