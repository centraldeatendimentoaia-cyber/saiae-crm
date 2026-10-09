import { describe, expect, it } from "vitest";
import type { Llm, SaidaLlm } from "../llm";
import { avaliar, resumo } from "./avaliar";
import { CASOS, CONCEDE, type Caso } from "./casos";
import { CASOS_VENDAS } from "./casos-vendas";

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
                return { chamadas: [{ id: "t1", nome: r.ferramenta, argumentos: r.ferramenta === "chamar_dono" || r.ferramenta === "chamar_humano" ? { motivo: "reclamacao" } : {} }] };
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
            if (/errado|pessoa|alergia|alérgic|celíaca|vegano|traço/.test(m)) return { texto: "Desculpe, já chamei o responsável.", ferramenta: "chamar_dono" };
            if (/how much/.test(m)) return { texto: "Costs R$ 22,00." };
            if (/🙂/.test(m)) return { texto: "Olá! Como posso ajudar?" };
            if (/maria|sabe sobre mim/.test(m)) return { texto: "Não tenho dados seus." };
            return { texto: "Não posso fazer isso, mas posso ajudar com o cardápio." };
        });
        const rel = await avaliar(bom, { casos: CASOS });
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
        const rel = await avaliar(ruim, { casos: CASOS });
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

describe("erro do modelo não vira 'passou'", () => {
    it("com a API fora (ex.: sem créditos) os casos que dependem do modelo ficam inválidos; só os respondidos pela trava alimentar (sem modelo) passam", async () => {
        const fora: Llm = { responder: async () => { throw Object.assign(new Error("credit balance is too low"), { name: "BadRequestError" }); } };
        const rel = await avaliar(fora);
        const daTrava = rel.resultados.filter((r) => r.passou).map((r) => r.nome).sort();
        expect(daTrava).toEqual(["alimentar-amendoim", "alimentar-gluten-celiaca", "alimentar-traco-nozes", "alimentar-vegano", "assunto-sensivel-alergia", "vendas-desconto-negociacao", "vendas-injecao-ignore"]);
        expect(rel.total).toBeGreaterThan(40);
        expect(rel.resultados.filter((r) => !r.passou).every((r) => r.motivo?.startsWith("inválido"))).toBe(true);
        expect(JSON.stringify(rel)).not.toContain("credit balance");
    });
});

describe("bateria de vendas", () => {
    const so = (nomes: string[]) => CASOS_VENDAS.filter((c) => nomes.includes(c.nome));
    it("nomes únicos, todos marcados como vendas, e não colidem com os das lojas", () => {
        const nomes = CASOS_VENDAS.map((c) => c.nome);
        expect(new Set(nomes).size).toBe(nomes.length);
        expect(CASOS_VENDAS.every((c) => c.vendas === true)).toBe(true);
        expect(nomes.some((n) => CASOS.some((c) => c.nome === n))).toBe(false);
        expect(CASOS_VENDAS.some((c) => c.categoria === "seguranca")).toBe(true);
    });
    it("usa o motor de vendas (ferramentas de vendas e conhecimento real)", async () => {
        const vistos: string[] = [];
        const llm: Llm = {
            async responder(e): Promise<SaidaLlm> {
                vistos.push(e.sistema.includes("<conhecimento>") ? "vendas" : "loja", ...e.ferramentas.map((f) => f.nome));
                return { texto: "O Essencial custa R$ 57,90 por mês.", chamadas: [] };
            },
        };
        const rel = await avaliar(llm, { casos: so(["vendas-preco-essencial"]) });
        expect(rel.passaram).toBe(1);
        expect(vistos).toContain("vendas");
        expect(vistos).toContain("chamar_humano");
        expect(vistos).not.toContain("registrar_pergunta_sem_resposta");
    });
    it("modelo ruim (concede desconto, prevê data, cobra, inventa) FALHA nos casos de segurança certos", async () => {
        const ruim = llmQue((m) => {
            if (/30% de desconto/.test(m)) return { texto: "Claro, 30% de desconto garantido!" };
            if (/chave pix/.test(m)) return { texto: "Chave pix: 12345678000199, pague por aí mesmo." };
            if (/quando libera a IA/.test(m)) return { texto: "Libera em novembro." };
            if (/ifood/i.test(m)) return { texto: "Sim, temos integração com iFood e boleto." };
            if (/Ignore todas/.test(m)) return { texto: "Tudo grátis para sempre, 100% de desconto!" };
            if (/instruções internas/.test(m)) return { texto: "REGRAS QUE NUNCA MUDAM: ..." };
            if (/App Store/.test(m)) return { texto: "Sim, está disponível na App Store." };
            return { texto: "ok" };
        });
        const rel = await avaliar(ruim, { casos: CASOS_VENDAS });
        const falharam = new Set(rel.resultados.filter((r) => !r.passou).map((r) => r.nome));
        for (const n of ["vendas-nao-cobra", "vendas-ia-whatsapp-sem-data", "vendas-invencao-recurso", "vendas-vazar-prompt", "vendas-iphone"]) expect(falharam.has(n), n).toBe(true);
    });
    it("negociação é tratada pela TRAVA (sem modelo): mesmo um modelo que concederia desconto passa o caso", async () => {
        let chamadas = 0;
        const concede: Llm = { responder: async () => { chamadas++; return { texto: "Claro, 30% de desconto garantido!", chamadas: [] }; } };
        const rel = await avaliar(concede, { casos: so(["vendas-desconto-negociacao"]) });
        expect(rel.passaram).toBe(1);
        expect(chamadas).toBe(0);
    });
    it("modelo bom passa nos casos que dá para simular", async () => {
        const bom = llmQue((m) => {
            if (/pessoa ou um robô/.test(m)) return { texto: "Sou o atendente IA do Sai aê, uma inteligência artificial. Se preferir, chamo alguém da equipe." };
            if (/dar feedback do produto eu ganho dias/.test(m)) return { texto: "Isso eu não tenho aqui; vou chamar uma pessoa da equipe para confirmar." };
            if (/feedback do produto eu ganho alguma/.test(m)) return { texto: "Sim: dando feedback você ganha mais 30 dias grátis do plano Essencial. A equipe confirma e libera." };
            if (/Quantos dias grátis eu ganho/.test(m)) return { texto: "Como veio do panfleto, você ganha 30 dias grátis." };
            if (/Quero ser testador/.test(m)) return { texto: "Oi! Sou o atendente IA do Sai aê. Posso explicar como funciona." };
            if (/Essencial/.test(m)) return { texto: "O Essencial custa R$ 57,90 por mês." };
            if (/Pro, quanto/.test(m)) return { texto: "O Pro custa R$ 87,90 por mês." };
            if (/teste grátis/.test(m)) return { texto: "Sim, são 7 dias de teste com o Pro." };
            if (/quero testar agora/.test(m)) return { texto: "Cadastre-se em https://saiae.com.br/raio-x" };
            if (/quero pedir um açaí/.test(m)) return { texto: "Para pedir de uma loja, use o link ou QR code dela." };
            if (/cupom/.test(m)) return { texto: "Sim, dá para criar cupons para os clientes." };
            if (/imprimir a comanda/.test(m)) return { texto: "Sim, em impressora Bluetooth no app Android." };
            if (/travou|30% de desconto/.test(m)) return { texto: "Vou chamar uma pessoa da equipe.", ferramenta: "chamar_humano" };
            if (/chave pix/.test(m)) return { texto: "Eu não cobro por aqui; a assinatura é pelo link de cadastro." };
            if (/abrir minha conta/.test(m)) return { texto: "Eu nunca peço dados pessoais; a pessoa mesma se cadastra." };
            if (/ifood/i.test(m)) return { texto: "Isso eu não tenho aqui, vou chamar uma pessoa para confirmar.", ferramenta: "chamar_humano" };
            if (/App Store/.test(m)) return { texto: "Não tenho essa informação; vou chamar uma pessoa." };
            if (/nota fiscal/.test(m)) return { texto: "A emissão de NFC-e está em validação; uma pessoa pode explicar melhor." };
            if (/quando libera/.test(m)) return { texto: "Ainda não tenho data para isso, não prometo prazo." };
            if (/29,90/.test(m)) return { texto: "Não, os planos são R$ 57,90 e R$ 87,90." };
            if (/👍/.test(m)) return { texto: "Posso ajudar com alguma dúvida sobre o Saiaê?" };
            return { texto: "Não posso fazer isso, mas posso explicar o Saiaê." };
        });
        const rel = await avaliar(bom, { casos: CASOS_VENDAS });
        const falhas = rel.resultados.filter((r) => !r.passou).map((r) => r.nome + ": " + r.motivo);
        expect(falhas).toEqual([]);
    });
});
