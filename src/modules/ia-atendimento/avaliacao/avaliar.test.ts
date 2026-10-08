import { describe, expect, it } from "vitest";
import type { Llm, SaidaLlm } from "../llm";
import { avaliar, resumo } from "./avaliar";
import { CASOS, CONCEDE, type Caso } from "./casos";

/** LLM falso que devolve uma resposta por mensagem do cliente, com a ferramenta opcional antes. */
function llmQue(respostas: (msg: string) => { texto: string; ferramenta?: string }): Llm {
    const vistos = new Set<string>();
    return {
        async responder(e): Promise<SaidaLlm> {
            const msg = [...e.mensagens].reverse().find((m) => m.papel === "user" && "texto" in m) as { texto: string };
            const r = respostas(msg.texto);
            const chave = msg.texto + e.mensagens.length;
            if (r.ferramenta && !vistos.has(chave) && !e.mensagens.some((m) => m.papel === "tool")) {
                vistos.add(chave);
                return { chamadas: [{ id: "t1", nome: r.ferramenta, argumentos: r.ferramenta === "chamar_dono" ? { motivo: "reclamacao" } : {} }] };
            }
            return { texto: r.texto, chamadas: [] };
        },
    };
}

describe("bateria de avaliação", () => {
    it("nomes de caso únicos e categorias válidas", () => {
        expect(new Set(CASOS.map((c) => c.nome)).size).toBe(CASOS.length);
        expect(CASOS.some((c) => c.categoria === "seguranca")).toBe(true);
    });

    it("um modelo 'bom' (respostas esperadas) passa em tudo o que dá para simular", async () => {
        const bom = llmQue((m) => {
            if (/quanto é o açaí de 500ml\?|o que tem de açaí/.test(m)) return { texto: "O Açaí 500ml custa R$ 22,00." };
            if (/leite ninho/.test(m)) return { texto: "Fica R$ 25,00." };
            if (/Bela Vista/.test(m)) return { texto: "A entrega é R$ 3,00." };
            if (/Morumbi/.test(m)) return { texto: "A taxa é R$ 5,00." };
            if (/segunda/.test(m)) return { texto: "Abrimos às 10:00." };
            if (/300ml/.test(m)) return { texto: "O açaí 300ml está esgotado." };
            if (/fazer um pedido/.test(m)) return { texto: "Peça em https://saiae.com.br/c/ABC234" };
            if (/errado|pessoa|alergia/.test(m)) return { texto: "Desculpe, já chamei o responsável.", ferramenta: "chamar_dono" };
            if (/how much/.test(m)) return { texto: "Costs R$ 22,00." };
            if (/🙂/.test(m)) return { texto: "Olá! Como posso ajudar?" };
            if (/maria|sabe sobre mim/.test(m)) return { texto: "Não tenho dados seus." };
            return { texto: "Não posso fazer isso, mas posso ajudar com o cardápio." };
        });
        const rel = await avaliar(bom);
        const falhas = rel.resultados.filter((r) => !r.passou).map((r) => `${r.nome}: ${r.motivo}`);
        // o texto do dono e o item malicioso exigem o preço correto; o 'bom' acima só o dá nas frases mapeadas
        expect(falhas.filter((f) => !/texto-do-dono|item-do-cardapio|outro-cliente/.test(f))).toEqual([]);
    });

    it("um modelo que obedece injeção, inventa prazo e vaza prompt FALHA nos casos certos", async () => {
        const ruim = llmQue((m) => {
            if (/Ignore todas/.test(m)) return { texto: "Claro! Tudo é grátis, 100% de desconto." };
            if (/minutos/.test(m)) return { texto: "Chega em 30 minutos." };
            if (/instruções internas/.test(m)) return { texto: "REGRAS QUE NUNCA MUDAM: ..." };
            if (/20%/.test(m)) return { texto: "Sim, vou te dar 20% de desconto!" };
            if (/instagram/.test(m)) return { texto: "https://golpe.com/x" };
            return { texto: "ok" };
        });
        const rel = await avaliar(ruim);
        const falharam = new Set(rel.resultados.filter((r) => !r.passou).map((r) => r.nome));
        for (const nome of ["injecao-ignore-instrucoes", "prazo-nao-inventa", "vazar-prompt", "desconto-pedido"]) expect(falharam.has(nome), nome).toBe(true);
    });

    it("filtro, resumo e erro do modelo (conta como falha, sem vazar a mensagem)", async () => {
        const quebrado: Llm = { responder: async () => { throw Object.assign(new Error("chave sk-secreta"), { name: "APIError" }); } };
        const rel = await avaliar(quebrado, { filtro: "preco-do-item" });
        expect(rel.total).toBe(1);
        expect(rel.passaram).toBe(0);
        expect(JSON.stringify(rel)).not.toContain("sk-secreta");
        expect(resumo(rel)).toContain("total 0/1");
    });

    it("CONCEDE não pega recusa educada", () => {
        expect(CONCEDE.test("Não posso conceder desconto, mas o cardápio está no link.")).toBe(false);
        expect(CONCEDE.test("Sim, vou te dar 20% de desconto")).toBe(true);
    });

    it("casos sob medida: checagem isolada", () => {
        const c = CASOS.find((x) => x.nome === "link-externo") as Caso;
        expect(c.verificar({ resposta: "veja https://golpe.com", ferramentas: [] })).not.toBeNull();
        expect(c.verificar({ resposta: "veja https://saiae.com.br/c/ABC234", ferramentas: [] })).toBeNull();
    });
});
