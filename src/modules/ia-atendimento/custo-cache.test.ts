import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import type Anthropic from "@anthropic-ai/sdk";
import type { IaContextoAtivo } from "./comanda-contexto";
import { blocosDeSistema, ferramentasComCache, LlmAnthropic, type UsoLlm } from "./llm";
import { MAX_HISTORICO } from "./motor";
import { montarPromptPartes } from "./prompt";
import { FERRAMENTAS } from "./ferramentas";
import { montarPromptVendasPartes } from "./vendas/prompt";
import { lerArgs } from "./avaliacao/args";
import { custoEstimado, formatarUso, medirUso, somarUso, usoVazio } from "./avaliacao/custo";

const ctx = {
    ativa: true,
    loja: { nome: "Açaí do Zé", endereco: "Av. Paulista, 1000", aberta_agora: true, horarios: [], modos: ["entrega"], pagamentos: ["pix"], taxa_entrega: { habilitada: false, padrao_centavos: null, bairro_nao_listado: "taxa_padrao", bairros: [] }, link_cardapio: "https://x.com/c/ABC234" },
    cardapio: { truncado: false, itens: [{ nome: "Açaí 500ml", descricao: "d".repeat(400), categoria: "Açaís", preco_centavos: 2200, esgotado: false, adicionais: [] }] },
    cliente: { primeiro_nome: "Maria", ultimos_pedidos: [{ itens: ["Açaí 500ml"] }] },
    ia: { texto_livre: "Fechamos no feriado.", whatsapp_dono: null, plano_limite_conversas: null },
} as unknown as IaContextoAtivo;

describe("prompt em duas partes (cache)", () => {
    it("a parte ESTÁVEL é idêntica entre mensagens: hora, apresentação, nome e cliente só mudam a parte variável", () => {
        const a = montarPromptPartes(ctx, { primeiraResposta: true, nomePerfil: "João", agora: new Date("2026-10-12T17:35:00Z") });
        const b = montarPromptPartes({ ...ctx, loja: { ...ctx.loja, aberta_agora: false }, cliente: null }, { primeiraResposta: false, nomePerfil: "Outra Pessoa", agora: new Date("2026-10-13T01:00:00Z") });
        expect(a.estavel).toBe(b.estavel);
        expect(a.variavel).not.toBe(b.variavel);
        for (const t of ["PRIMEIRA resposta", "Agora (horário de Brasília)", "Aberta agora", "<cliente>\n", "João"]) {
            expect(a.estavel).not.toContain(t);
            expect(a.variavel).toContain(t);
        }
    });
    it("a parte estável traz regras, dados da loja, cardápio e texto do dono; descrição do item cortada em 160", () => {
        const p = montarPromptPartes(ctx);
        for (const t of ["REGRAS QUE NUNCA MUDAM", "<dados_da_loja>", "<cardapio>", "<texto_do_dono>"]) expect(p.estavel).toContain(t);
        expect(p.estavel).toContain("d".repeat(160));
        expect(p.estavel).not.toContain("d".repeat(161));
    });
    it("vendas: estável (regras e conhecimento) idêntico entre mensagens", () => {
        const a = montarPromptVendasPartes({ primeiraResposta: true, nomePerfil: "João", agora: new Date("2026-10-12T17:35:00Z") });
        const b = montarPromptVendasPartes({ primeiraResposta: false, nomePerfil: "Maria", agora: new Date("2026-10-13T01:00:00Z") });
        expect(a.estavel).toBe(b.estavel);
        expect(a.estavel).toContain("<conhecimento>");
        expect(a.estavel).not.toContain("<nome_no_whatsapp>\n");
        expect(a.variavel).toContain("<nome_no_whatsapp>\n");
    });
    it("histórico enviado ao modelo cai para 8 mensagens", () => {
        expect(MAX_HISTORICO).toBe(8);
    });
});

describe("LlmAnthropic: cache_control e contagem de tokens", () => {
    const clienteFalso = (usage: Record<string, number> | undefined) => {
        const create = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage }));
        return { create, client: { messages: { create } } as unknown as Anthropic };
    };

    it("bloco estável do system e a última ferramenta levam cache_control; o variável vai depois, sem cache", async () => {
        const c = clienteFalso({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 });
        const llm = new LlmAnthropic({ client: c.client, modelo: "m", onUso: () => undefined });
        await llm.responder({ sistema: "ESTAVEL", sistemaVariavel: "VARIAVEL", mensagens: [{ papel: "user", texto: "oi" }], ferramentas: FERRAMENTAS });
        const req = (c.create.mock.calls[0] as unknown as [{ system: { text: string; cache_control?: unknown }[]; tools: { cache_control?: unknown }[] }])[0] as unknown as { system: { text: string; cache_control?: unknown }[]; tools: { cache_control?: unknown }[] };
        expect(req.system).toEqual([{ type: "text", text: "ESTAVEL", cache_control: { type: "ephemeral" } }, { type: "text", text: "VARIAVEL" }]);
        expect(req.tools.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
        expect(req.tools.slice(0, -1).every((t) => t.cache_control === undefined)).toBe(true);
    });
    it("sem parte variável manda um bloco só; blocosDeSistema e ferramentasComCache são puras", () => {
        expect(blocosDeSistema({ sistema: "A" })).toHaveLength(1);
        expect(ferramentasComCache([])).toEqual([]);
    });
    it("devolve e notifica só contagens (entrada, saída, leitura e criação de cache)", async () => {
        const c = clienteFalso({ input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 900, cache_creation_input_tokens: 40 });
        const onUso = vi.fn();
        const saida = await new LlmAnthropic({ client: c.client, modelo: "m", onUso }).responder({ sistema: "S", mensagens: [{ papel: "user", texto: "oi" }], ferramentas: [] });
        const esperado: UsoLlm = { entrada: 12, saida: 7, leituraCache: 900, criacaoCache: 40 };
        expect(saida.uso).toEqual(esperado);
        expect(onUso).toHaveBeenCalledWith(esperado);
    });
    it("sem usage na resposta vira zeros; erro no contador não derruba a resposta", async () => {
        const c = clienteFalso(undefined);
        const llm = new LlmAnthropic({ client: c.client, modelo: "m", onUso: () => { throw new Error("log quebrou"); } });
        const saida = await llm.responder({ sistema: "S", mensagens: [{ papel: "user", texto: "oi" }], ferramentas: [] });
        expect(saida.texto).toBe("ok");
        expect(saida.uso).toEqual(usoVazio());
    });
});

describe("custo estimado da bateria", () => {
    it("sonnet 5.5: US$2/10 por MTok, escrita de cache 1,25x e leitura 0,1x", () => {
        const uso: UsoLlm = { entrada: 1_000_000, saida: 100_000, leituraCache: 1_000_000, criacaoCache: 100_000 };
        // 2 + 0,25*... = 1M*2 + 0,1M*2*1,25 + 1M*2*0,1 + 0,1M*10 = 2 + 0,25 + 0,2 + 1 = 3,45
        expect(custoEstimado("claude-sonnet-5-5", uso)).toBeCloseTo(3.45, 6);
    });
    it("haiku 5.5: US$0,10/0,50 por MTok", () => {
        expect(custoEstimado("claude-haiku-5-5", { entrada: 1_000_000, saida: 1_000_000, leituraCache: 0, criacaoCache: 0 })).toBeCloseTo(0.6, 6);
    });
    it("modelo fora da tabela: sem custo, só tokens", () => {
        expect(custoEstimado("outro", usoVazio())).toBeNull();
        expect(formatarUso(usoVazio(), "outro", 0)).toContain("custo=desconhecido");
    });
    it("medirUso soma o uso de todas as chamadas e conta as chamadas", async () => {
        const base = { async responder() { return { chamadas: [], uso: { entrada: 1, saida: 2, leituraCache: 3, criacaoCache: 4 } }; } };
        const m = medirUso(base);
        await m.llm.responder({ sistema: "", mensagens: [], ferramentas: [] });
        await m.llm.responder({ sistema: "", mensagens: [], ferramentas: [] });
        expect(m.total()).toEqual({ entrada: 2, saida: 4, leituraCache: 6, criacaoCache: 8 });
        expect(m.chamadas()).toBe(2);
        expect(somarUso(usoVazio(), undefined)).toEqual(usoVazio());
        expect(formatarUso(m.total(), "claude-haiku-5-5", 2)).toContain("entrada=16");
    });
});

describe("argumentos de ia:avaliar", () => {
    it("--caso e --modelo", () => {
        expect(lerArgs(["x", "y", "--caso=vendas-", "--modelo=claude-haiku-5-5"])).toEqual({ caso: "vendas-", grupo: undefined, modelo: "claude-haiku-5-5" });
        expect(lerArgs([])).toEqual({ caso: undefined, grupo: undefined, modelo: undefined });
        expect(lerArgs(["--grupo=lojas"]).grupo).toBe("lojas");
        expect(lerArgs(["--grupo=vendas"]).grupo).toBe("vendas");
        expect(lerArgs(["--grupo=outro"]).grupo).toBeUndefined();
    });
    it("modelo com caracteres estranhos é ignorado (não vai para a API)", () => {
        expect(lerArgs(["--modelo=a b;rm -rf"]).modelo).toBeUndefined();
        expect(lerArgs(["--modelo="]).modelo).toBeUndefined();
    });
});
