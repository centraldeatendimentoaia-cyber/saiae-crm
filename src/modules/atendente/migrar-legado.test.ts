import { describe, expect, it, vi } from "vitest";
import type { EntradaLlm, Llm, SaidaLlm } from "@/modules/ia-atendimento/llm";
import type { ConfigAgente } from "@/modules/agente-salao/agente";
import { montarPromptSalao, MSG_TRANSFERENCIA, responderSalao } from "@/modules/agente-salao/motor";
import { MODELOS } from "./modelos-prontos";
import { responderAtendente, type EntradaAtendente } from "./motor";
import { montarPromptAtendente } from "./prompt";
import { avisoRascunhoExistente, decidirGravacao, hostDoBanco, lerArgumentos, resumirTreino, treinoAPartirDoLegado, treinoAPartirDoLegadoComAvisos } from "./migrar-legado";
import { LIMITE_BASE_TOTAL, TreinoSchema } from "./treino";

const T0 = new Date("2026-10-13T13:00:00Z");
const LINK = "https://agendamento.avec.beauty/?slug=lavi-concept";
const CONHECIMENTO = "Você é a Lavínia. Progressiva: R$ 350,00. Instagram: https://instagram.com/laviconcept";
const PROMOCOES = "Clube da Tati: 10% de desconto até 30/11.";

const cfg = (over: Partial<ConfigAgente> = {}): ConfigAgente => ({
    sessionId: "s1",
    ativo: true,
    nome: "Lavínia",
    nomeNegocio: "LAVI Concept",
    etiquetasInteresse: ["Interesse: Progressiva", "Interesse: Unhas"],
    etiquetaAguardando: null,
    etiquetaFollowUp: null,
    etiquetaAnuncio: null,
    conhecimento: CONHECIMENTO,
    promocoes: PROMOCOES,
    linkAgendamento: LINK,
    grupoRecepcaoJid: null,
    emailAviso: null,
    followUpTexto: "Oi, {nome}! Conseguiu decidir?",
    numerosIgnorados: [],
    followUpHoras: 24,
    pausaHoras: 12,
    diasAbertos: "1,2,3,4,5,6",
    horaAbre: 9,
    horaFecha: 19,
    ...over,
});

describe("treinoAPartirDoLegado", () => {
    it("passa no TreinoSchema e mapeia identidade, base, desfecho e follow-up", () => {
        const t = treinoAPartirDoLegado(cfg());
        expect(TreinoSchema.safeParse(t).success).toBe(true);
        expect(t.identidade).toMatchObject({ nome: "Lavínia", negocio: "LAVI Concept" });
        expect(t.base.map((b) => b.texto)).toEqual([CONHECIMENTO, PROMOCOES]);
        expect(t.roteiro.desfecho).toEqual({ tipo: "link", link: LINK });
        expect(t.followUp).toMatchObject({ maxMensagens: 1, intervaloHoras: 24, textos: ["Oi, {nome}! Conseguiu decidir?"] });
        expect(t.gatilhos).toEqual(MODELOS.salao.gatilhos);
    });
    it("sem promoções não cria item de base; sem follow-up usa o texto do modelo", () => {
        const t = treinoAPartirDoLegado(cfg({ promocoes: "  ", followUpTexto: null }));
        expect(t.base).toHaveLength(1);
        expect(t.followUp.textos).toEqual(MODELOS.salao.followUp.textos);
    });
    it("link ausente vira desfecho pessoa; link inválido também, com aviso", () => {
        expect(treinoAPartirDoLegado(cfg({ linkAgendamento: null })).roteiro.desfecho).toEqual({ tipo: "pessoa" });
        const r = treinoAPartirDoLegadoComAvisos(cfg({ linkAgendamento: "http://inseguro.com/x" }));
        expect(r.treino.roteiro.desfecho).toEqual({ tipo: "pessoa" });
        expect(r.avisos.join(" ")).toMatch(/link/i);
    });
    it("limita sem lançar e avisa: base enorme, horas fora da faixa, texto de follow-up longo", () => {
        const r = treinoAPartirDoLegadoComAvisos(cfg({ conhecimento: "x".repeat(LIMITE_BASE_TOTAL + 500), followUpHoras: 5000, followUpTexto: "y".repeat(2500) }));
        expect(TreinoSchema.safeParse(r.treino).success).toBe(true);
        expect(r.treino.base.reduce((s, b) => s + b.texto.length, 0)).toBeLessThanOrEqual(LIMITE_BASE_TOTAL);
        expect(r.treino.base.some((b) => b.texto === PROMOCOES)).toBe(true); // promoções não são cortadas
        expect(r.treino.followUp.intervaloHoras).toBe(720);
        expect(r.treino.followUp.textos[0]).toHaveLength(2000);
        expect(r.avisos).toHaveLength(3);
    });
    it("negócio sem nome usa um texto neutro e avisa", () => {
        const r = treinoAPartirDoLegadoComAvisos(cfg({ nomeNegocio: null }));
        expect(r.treino.identidade.negocio).toBe("nosso salão");
        expect(r.avisos.join(" ")).toMatch(/negócio/i);
    });
    it("não altera o objeto de entrada nem os modelos", () => {
        const antes = JSON.stringify(MODELOS.salao);
        const c = cfg();
        const copia = JSON.stringify(c);
        treinoAPartirDoLegado(c);
        expect(JSON.stringify(c)).toBe(copia);
        expect(JSON.stringify(MODELOS.salao)).toBe(antes);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Equivalência entre o motor do salão (legado) e o neutro com o treino migrado.
//
// DIFERENÇAS INTENCIONAIS (não são regressões; por isso não são afirmadas como iguais):
//  1. Nomes de ferramenta: chamar_recepcao -> passar_para_pessoa, enviar_link_agendamento -> enviar_link.
//  2. Gatilhos por palavra-chave (pedido de pessoa, reclamação...) passam para a pessoa ANTES de chamar o modelo no motor
//     neutro; o legado sempre consulta o modelo. A frase enviada é a mesma (MSG_TRANSFERENCIA).
//  3. Prompt: o neutro acrescenta objeções, exemplos, roteiro e regra de objeção; promoções ficam na base (não numa
//     seção "PROMOÇÕES VIGENTES"). O conhecimento e o texto das promoções, porém, entram iguais.
//  4. Mensagem do cliente vai entre <mensagem_recebida> no neutro.
//  5. Motivos: legado tem 9 (audio, agendamento, ...), o neutro usa os ids dos gatilhos + fora_da_base.
//  6. registrar_venda existe só no neutro.
//  7. Depois de passar para pessoa, o neutro sempre troca o texto do modelo pela frase fixa; o legado só quando vem vazio.
// ---------------------------------------------------------------------------------------------------------------

const NOME_NEUTRO: Record<string, string> = { chamar_recepcao: "passar_para_pessoa", enviar_link_agendamento: "enviar_link", etiquetar: "etiquetar" };

interface Roteiro {
    nome: string;
    texto: string;
    /** Passos do modelo por motor (os nomes de ferramenta diferem). */
    passos: (motor: "legado" | "neutro") => SaidaLlm[];
}
const chamada = (motor: "legado" | "neutro", legado: string, args: unknown = {}): SaidaLlm => ({
    texto: "",
    chamadas: [{ id: "c1", nome: motor === "legado" ? legado : NOME_NEUTRO[legado], argumentos: args }],
});
const fim = (texto: string): SaidaLlm => ({ texto, chamadas: [] });

const ROTEIROS: Roteiro[] = [
    { nome: "pergunta de preço", texto: "Quanto custa a progressiva?", passos: () => [fim("A progressiva custa R$ 350,00. Quer que eu te passe os horários?")] },
    { nome: "objeção vou pensar", texto: "Vou pensar, tá?", passos: () => [fim("Claro, sem pressa 💛 Se ficou alguma dúvida, me conta.")] },
    { nome: "pede uma pessoa", texto: "Quero falar com uma pessoa", passos: (m) => [chamada(m, "chamar_recepcao", { motivo: "pediu_humano" }), fim("")] },
    { nome: "pede para agendar e link", texto: "Quero agendar, tem link?", passos: (m) => [chamada(m, "enviar_link_agendamento"), fim(`Pode agendar por aqui: ${LINK}`)] },
    { nome: "etiquetar interesse", texto: "Tenho interesse em progressiva", passos: (m) => [chamada(m, "etiquetar", { etiqueta: "Interesse: Progressiva" }), fim("Ótima escolha! Posso te ajudar com o horário?")] },
];

function llmRoteirizado(passos: SaidaLlm[]) {
    const entradas: EntradaLlm[] = [];
    let i = 0;
    const llm: Llm = { responder: async (e) => { entradas.push(JSON.parse(JSON.stringify(e))); return passos[Math.min(i++, passos.length - 1)]; } };
    return { llm, entradas };
}

async function rodarLegado(c: ConfigAgente, r: Roteiro) {
    const { llm, entradas } = llmRoteirizado(r.passos("legado"));
    const etiquetas: string[] = [];
    const recepcao = vi.fn(async () => true);
    const saida = await responderSalao(
        { llm, historico: [{ direcao: "in", texto: r.texto }], logger: { warn: vi.fn() } },
        {
            conhecimento: c.conhecimento, nome: c.nome, negocio: c.nomeNegocio, promocoes: c.promocoes, agora: T0, salaoAberto: true, textoCliente: r.texto,
            acoes: { chamarRecepcao: recepcao, etiquetar: async (e) => (etiquetas.push(e), true), etiquetasPermitidas: c.etiquetasInteresse, linkAgendamento: c.linkAgendamento },
        },
    );
    return { mensagens: saida.mensagens, passou: saida.chamouRecepcao, etiquetas, nPedidos: recepcao.mock.calls.length, entradas };
}

async function rodarNeutro(c: ConfigAgente, r: Roteiro) {
    const { llm, entradas } = llmRoteirizado(r.passos("neutro"));
    const etiquetas: string[] = [];
    const pessoa = vi.fn(async () => true);
    const e: EntradaAtendente = { texto: r.texto, historico: [{ direcao: "in", texto: r.texto }], agora: T0, atendimentoHumanoAberto: true, primeiraResposta: true, mensagensSemAvancar: 0 };
    const saida = await responderAtendente(
        {
            llm, treino: treinoAPartirDoLegado(c), link: c.linkAgendamento, etiquetas: c.etiquetasInteresse,
            onPassarParaPessoa: pessoa, onEtiquetar: async (x) => (etiquetas.push(x), true), onRegistrarVenda: async () => true, logger: { warn: vi.fn() },
        },
        e,
    );
    return { mensagens: saida.mensagens, passou: saida.passouParaPessoa, etiquetas, nPedidos: pessoa.mock.calls.length, entradas };
}

describe("equivalência legado x neutro (treino migrado)", () => {
    it("(a) o prompt estável traz o mesmo conhecimento, as mesmas promoções e o mesmo link do prompt do salão", () => {
        const c = cfg();
        const legado = montarPromptSalao({ conhecimento: c.conhecimento, nome: c.nome, negocio: c.nomeNegocio, promocoes: c.promocoes, primeiraResposta: true, salaoAberto: true, agora: T0 });
        const neutro = montarPromptAtendente(treinoAPartirDoLegado(c), { agora: T0, atendimentoHumanoAberto: true, primeiraResposta: true });
        // Nenhum dos dois prompts escreve o link de agendamento (ele chega por ferramenta; ver o teste do link abaixo).
        // Aqui se compara só o texto do dono: conhecimento e promoções.
        for (const trecho of [CONHECIMENTO, PROMOCOES]) {
            expect(legado.estavel, `legado: ${trecho}`).toContain(trecho);
            expect(neutro.estavel, `neutro: ${trecho}`).toContain(trecho);
        }
        expect(neutro.estavel).toContain("Lavínia");
        expect(neutro.estavel).toContain("LAVI Concept");
    });

    for (const r of ROTEIROS) {
        it(`(b) ${r.nome}: mesmas mensagens ao cliente, mesma passagem para pessoa e mesmas etiquetas`, async () => {
            const c = cfg();
            const a = await rodarLegado(c, r);
            const b = await rodarNeutro(c, r);
            expect(b.mensagens).toEqual(a.mensagens);
            expect(b.passou).toBe(a.passou);
            expect(b.nPedidos).toBe(a.nPedidos);
            expect(b.etiquetas).toEqual(a.etiquetas);
        });
    }

    it("(b) a frase de transferência dos dois motores é MSG_TRANSFERENCIA", async () => {
        const r = ROTEIROS.find((x) => x.nome === "pede uma pessoa")!;
        expect((await rodarLegado(cfg(), r)).mensagens).toEqual([MSG_TRANSFERENCIA]);
        expect((await rodarNeutro(cfg(), r)).mensagens).toEqual([MSG_TRANSFERENCIA]);
    });

    it("diferença intencional 2: o neutro passa para a pessoa pelo gatilho, sem chamar o modelo; o legado consulta o modelo", async () => {
        const r = ROTEIROS.find((x) => x.nome === "pede uma pessoa")!;
        expect((await rodarLegado(cfg(), r)).entradas.length).toBeGreaterThan(0);
        expect((await rodarNeutro(cfg(), r)).entradas).toHaveLength(0);
    });

    it("o link entregue ao cliente é o mesmo e vem do treino migrado quando o motor não recebe link", async () => {
        const c = cfg();
        const { llm } = llmRoteirizado([chamada("neutro", "enviar_link_agendamento"), fim(`Aqui: ${LINK}`)]);
        const s = await responderAtendente(
            { llm, treino: treinoAPartirDoLegado(c), etiquetas: [], onPassarParaPessoa: async () => true, onEtiquetar: async () => true, onRegistrarVenda: async () => true, logger: { warn: vi.fn() } },
            { texto: "link?", historico: [{ direcao: "in", texto: "link?" }], agora: T0, atendimentoHumanoAberto: true, primeiraResposta: true, mensagensSemAvancar: 0 },
        );
        expect(s.mensagens.join(" ")).toContain(LINK);
    });
});

describe("migração: bordas", () => {
    it("promoções enormes são cortadas com aviso, sem lançar, e o conhecimento mantém prioridade", () => {
        const r = treinoAPartirDoLegadoComAvisos(cfg({ promocoes: "p".repeat(LIMITE_BASE_TOTAL + 10), conhecimento: "k".repeat(LIMITE_BASE_TOTAL) }));
        expect(TreinoSchema.safeParse(r.treino).success).toBe(true);
        const [k, p] = r.treino.base;
        expect(p.texto).toHaveLength(LIMITE_BASE_TOTAL / 4);
        expect(k.texto).toHaveLength(LIMITE_BASE_TOTAL - p.texto.length);
        expect(r.avisos.filter((a) => /promoções/i.test(a)).length).toBeGreaterThan(0);
    });
    it("link com U+200B ou NUL cai para pessoa com aviso", () => {
        for (const c of [0x200b, 0x0000]) {
            const r = treinoAPartirDoLegadoComAvisos(cfg({ linkAgendamento: "https://exemplo.com/a" + String.fromCharCode(c) + "b" }));
            expect(r.treino.roteiro.desfecho).toEqual({ tipo: "pessoa" });
            expect(r.avisos.join(" ")).toMatch(/link/i);
        }
    });
    it("avisos para nome e negócio cortados, nome vazio e conhecimento vazio", () => {
        const a = treinoAPartirDoLegadoComAvisos(cfg({ nome: "n".repeat(300), nomeNegocio: "b".repeat(300) }));
        expect(a.treino.identidade.nome).toHaveLength(200);
        expect(a.treino.identidade.negocio).toHaveLength(200);
        expect(a.avisos).toHaveLength(2);
        const b = treinoAPartirDoLegadoComAvisos(cfg({ nome: "  ", conhecimento: "" }));
        expect(b.treino.identidade.nome).toBe(MODELOS.salao.identidade.nome);
        expect(b.avisos.join(" ")).toMatch(/nome da atendente/);
        expect(b.avisos.join(" ")).toMatch(/conhecimento está vazio/);
    });
});

describe("decidirGravacao", () => {
    it("recusa quando já há rascunho, salvo --sobrescrever", () => {
        expect(decidirGravacao({ rascunhoExiste: true, sobrescrever: false })).toMatchObject({ ok: false, erro: expect.stringMatching(/--sobrescrever/) });
        expect(decidirGravacao({ rascunhoExiste: true, sobrescrever: true })).toEqual({ ok: true });
        expect(decidirGravacao({ rascunhoExiste: false, sobrescrever: false })).toEqual({ ok: true });
        expect(avisoRascunhoExistente(true)).toMatch(/rascunho/);
        expect(avisoRascunhoExistente(false)).toBe("");
    });
    it("lerArgumentos aceita --sobrescrever", () => {
        expect(lerArgumentos(["--sessao", "a", "--aplicar", "--confirmo-ambiente", "--sobrescrever"])).toMatchObject({ sobrescrever: true });
    });
});

describe("lerArgumentos", () => {
    it("exige --sessao e aceita --aplicar com --confirmo-ambiente", () => {
        expect(lerArgumentos([])).toMatchObject({ erro: expect.stringMatching(/--sessao/) });
        expect(lerArgumentos(["--sessao"])).toMatchObject({ erro: expect.any(String) });
        expect(lerArgumentos(["--sessao", "abc"])).toEqual({ sessao: "abc", aplicar: false, confirmoAmbiente: false, sobrescrever: false });
        expect(lerArgumentos(["--sessao", "abc", "--aplicar", "--confirmo-ambiente"])).toEqual({ sessao: "abc", aplicar: true, confirmoAmbiente: true, sobrescrever: false });
    });
    it("--aplicar sem --confirmo-ambiente é erro, e argumento desconhecido também", () => {
        expect(lerArgumentos(["--sessao", "abc", "--aplicar"])).toMatchObject({ erro: expect.stringMatching(/--confirmo-ambiente/) });
        expect(lerArgumentos(["--sessao", "abc", "--publicar"])).toMatchObject({ erro: expect.stringMatching(/--publicar/) });
    });
});

describe("hostDoBanco e resumirTreino", () => {
    it("mostra só o host, nunca usuário nem senha", () => {
        const h = hostDoBanco("postgresql://usuario:segredo@db.exemplo.com:5432/crm?sslmode=require");
        expect(h).toBe("db.exemplo.com:5432");
        expect(h).not.toMatch(/segredo|usuario/);
        expect(hostDoBanco(undefined)).toBe("(DATABASE_URL ausente)");
        expect(hostDoBanco("lixo")).toBe("host ilegível");
        const h2 = hostDoBanco("mysql://user:p/ss#w@host:3306/db");
        expect(h2).toBe("host:3306");
        expect(h2).not.toMatch(/user|ss|w@/);
    });
    it("resumo traz seções, tamanhos e avisos", () => {
        const { treino, avisos } = treinoAPartirDoLegadoComAvisos(cfg({ linkAgendamento: "http://x.com" }));
        const s = resumirTreino(treino, avisos);
        expect(s).toMatch(/base: 2 /);
        expect(s).toMatch(/desfecho: pessoa/);
        expect(s).toMatch(/AVISO/);
    });
});
