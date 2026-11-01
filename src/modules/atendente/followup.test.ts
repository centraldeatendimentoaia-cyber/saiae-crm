import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversaEstado } from "@/modules/agente-salao/estado";

// ---- rodada (rodarFollowUps) com banco, WhatsApp e treino simulados
const m = vi.hoisted(() => ({
    convs: [] as Record<string, any>[],
    feitosHoje: 0,
    treino: null as any,
    optout: new Set<string>(),
    falhar: false,
    perderClaim: false,
    quebrarTreino: false,
    sessoes: ["s1"],
    treinoPor: null as Record<string, any> | null,
    enviados: [] as { jid: string; texto: string }[],
}));
const sock = vi.hoisted(() => ({
    sendMessage: async (jid: string, c: { text: string }) => {
        if (m.falhar) throw new Error("falhou");
        m.enviados.push({ jid, texto: c.text });
        return {};
    },
}));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        agenteConfig: { findMany: vi.fn(async () => m.sessoes.map((sessionId) => ({ sessionId }))) },
        agenteConversa: {
            count: vi.fn(async () => m.feitosHoje),
            findMany: vi.fn(async ({ where }: any) => {
                if (where.OR && m.quebrarTreino) throw new Error("banco");
                return m.convs.filter((c) => (c.sessionId ?? "s1") === where.sessionId);
            }),
            updateMany: vi.fn(async ({ where, data }: any) => {
                const igual = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
                const c = m.convs.find((x) => x.id === where.id);
                if (!c || m.perderClaim) return { count: 0 };
                if ("followUpEnvios" in where && c.followUpEnvios !== where.followUpEnvios) return { count: 0 };
                if ("followUpEm" in where && !igual(c.followUpEm, where.followUpEm)) return { count: 0 };
                Object.assign(c, data);
                return { count: 1 };
            }),
            update: vi.fn(async ({ where, data }: any) => Object.assign(m.convs.find((c) => c.id === where.id)!, data)),
        },
    },
}));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: () => ({ socket: sock }) } }));
vi.mock("@/lib/optout", () => ({ isOptedOut: vi.fn(async (_s: string, jid: string) => m.optout.has(jid)) }));
vi.mock("@/modules/agente-salao/agente", () => ({
    carregarConfigAgente: vi.fn(async () => ({ ativo: true, followUpHoras: 12, followUpTexto: null, etiquetaFollowUp: null, diasAbertos: "1,2,3,4,5,6", horaAbre: 9, horaFecha: 18 })),
    aplicarEtiquetaNaSessao: vi.fn(async () => true),
}));
vi.mock("@/modules/atendente/integracao", () => ({ usarAtendenteNovo: vi.fn(async (s: string) => (m.treinoPor ? m.treinoPor[s] ?? null : m.treino)) }));

import { proximoFollowUp } from "./followup";
import { rodarFollowUps } from "@/modules/agente-salao/followup";

const AGORA = new Date("2026-10-13T13:00:00Z"); // terça 10h em Brasília
const hAntes = (h: number) => new Date(AGORA.getTime() - h * 3_600_000);
const FU = { maxMensagens: 2, intervaloHoras: 24, textos: ["Oi, {nome}! Ainda quer agendar?", "Oi {nome}, última chamada!", "terceiro"] };
const conv = (over: Partial<ConversaEstado & { followUpEnvios: number; nomePerfil: string | null }> = {}) => ({
    estado: "ia", pausadaAte: null, ultimaInboundAt: hAntes(100), ultimaIaAt: hAntes(24), ultimaIaPerguntou: true, ultimaHumanoAt: null, followUpEm: null,
    followUpEnvios: 0, nomePerfil: "ANA souza", ...over,
});
const prox = (c = conv(), extra: { expedienteAberto?: boolean; followUp?: typeof FU } = {}) =>
    proximoFollowUp({ conv: c, followUp: extra.followUp ?? FU, agora: AGORA, expedienteAberto: extra.expedienteAberto ?? true });

describe("proximoFollowUp", () => {
    it("0 envios e intervalo vencido (exatamente no limite) envia o texto 0 com o primeiro nome", () => {
        expect(prox()).toEqual({ enviar: true, texto: "Oi, Ana! Ainda quer agendar?" });
    });
    it("antes do intervalo não envia", () => {
        expect(prox(conv({ ultimaIaAt: hAntes(23.99) })).enviar).toBe(false);
    });
    it("1 envio e maxMensagens 2: envia o texto 1, contando o intervalo desde o follow-up anterior", () => {
        expect(prox(conv({ followUpEnvios: 1, ultimaIaAt: hAntes(48), followUpEm: hAntes(24) }))).toEqual({ enviar: true, texto: "Oi Ana, última chamada!" });
        expect(prox(conv({ followUpEnvios: 1, ultimaIaAt: hAntes(48), followUpEm: hAntes(10) })).enviar).toBe(false);
    });
    it("2 envios com maxMensagens 2 não envia", () => {
        expect(prox(conv({ followUpEnvios: 2, ultimaIaAt: hAntes(72), followUpEm: hAntes(24) })).enviar).toBe(false);
    });
    it("textos mais curtos que maxMensagens: para no último texto", () => {
        const followUp = { maxMensagens: 5, intervaloHoras: 24, textos: ["só um"] };
        expect(prox(conv(), { followUp })).toEqual({ enviar: true, texto: "só um" });
        expect(prox(conv({ followUpEnvios: 1, followUpEm: hAntes(24), ultimaIaAt: hAntes(48) }), { followUp }).enviar).toBe(false);
    });
    it("conversa encerrada (IA não perguntou nada) não começa sequência; sequência já iniciada continua", () => {
        expect(prox(conv({ ultimaIaPerguntou: false })).enviar).toBe(false);
        expect(prox(conv({ ultimaIaPerguntou: false, followUpEnvios: 1, followUpEm: hAntes(24), ultimaIaAt: hAntes(48) })).enviar).toBe(true);
    });
    it("troca de motor: followUpEm preenchido com 0 envios = lembrete legado já enviado, não manda nada", () => {
        expect(prox(conv({ followUpEnvios: 0, followUpEm: hAntes(24), ultimaIaAt: hAntes(48) })).enviar).toBe(false);
    });
    it("intervaloHoras abaixo de 12 vale como 12", () => {
        const followUp = { ...FU, intervaloHoras: 1 };
        expect(prox(conv({ ultimaIaAt: hAntes(11.9) }), { followUp }).enviar).toBe(false);
        expect(prox(conv({ ultimaIaAt: hAntes(12) }), { followUp }).enviar).toBe(true);
    });
    it("maxMensagens 0 desliga", () => {
        expect(prox(conv(), { followUp: { ...FU, maxMensagens: 0 } }).enviar).toBe(false);
    });
    it("cliente respondeu depois da IA não envia", () => {
        expect(prox(conv({ ultimaInboundAt: hAntes(1) })).enviar).toBe(false);
    });
    it("contador fica velho quando a cliente responde (followUpEm zerado): a sequência recomeça do texto 0", () => {
        expect(prox(conv({ followUpEnvios: 2, followUpEm: null }))).toMatchObject({ enviar: true, texto: "Oi, Ana! Ainda quer agendar?" });
    });
    it("pessoa assumiu (estado humano ou pessoa falou depois da IA) não envia", () => {
        expect(prox(conv({ estado: "humano" })).enviar).toBe(false);
        expect(prox(conv({ estado: "humano", pausadaAte: new Date(AGORA.getTime() + 3_600_000) })).enviar).toBe(false);
        expect(prox(conv({ ultimaHumanoAt: hAntes(2) })).enviar).toBe(false);
    });
    it("fora do expediente não envia", () => {
        expect(prox(conv(), { expedienteAberto: false }).enviar).toBe(false);
    });
    it("conversa velha demais (passou do intervalo + 36 h) não recebe", () => {
        expect(prox(conv({ ultimaIaAt: hAntes(24 + 37), ultimaInboundAt: hAntes(24 + 38) })).enviar).toBe(false);
    });
    it("sem nome remove o {nome} sem deixar espaço duplo nem vírgula solta", () => {
        expect(prox(conv({ nomePerfil: null })).texto).toBe("Oi! Ainda quer agendar?");
        expect(prox(conv({ nomePerfil: "🙂", followUpEnvios: 1, followUpEm: hAntes(24), ultimaIaAt: hAntes(48) })).texto).toBe("Oi, última chamada!");
    });
});

describe("rodarFollowUps com treino publicado", () => {
    const linha = (id: string, over: Record<string, any> = {}) => ({ id, jid: `${id}@s.whatsapp.net`, telefone: id, servico: null, ...conv(), ...over });
    const rodar = async () => {
        const p = rodarFollowUps(AGORA);
        await vi.runAllTimersAsync();
        return p;
    };
    beforeEach(() => {
        vi.useFakeTimers();
        m.convs = [];
        m.feitosHoje = 0;
        m.treino = { followUp: FU };
        m.optout.clear();
        m.falhar = false;
        m.perderClaim = false;
        m.quebrarTreino = false;
        m.sessoes = ["s1"];
        m.treinoPor = null;
        m.enviados = [];
    });
    afterEach(() => vi.useRealTimers());

    it("envia, incrementa followUpEnvios e grava followUpEm", async () => {
        m.convs = [linha("5561900000001")];
        expect(await rodar()).toBe(1);
        expect(m.enviados).toEqual([{ jid: "5561900000001@s.whatsapp.net", texto: "Oi, Ana! Ainda quer agendar?" }]);
        expect(m.convs[0]).toMatchObject({ followUpEnvios: 1, followUpEm: expect.any(Date) });
    });
    it("descadastrado nunca recebe", async () => {
        m.convs = [linha("5561900000001")];
        m.optout.add("5561900000001@s.whatsapp.net");
        expect(await rodar()).toBe(0);
        expect(m.enviados).toEqual([]);
    });
    it("falha no envio desfaz a reserva", async () => {
        m.convs = [linha("5561900000001")];
        m.falhar = true;
        expect(await rodar()).toBe(0);
        expect(m.convs[0]).toMatchObject({ followUpEnvios: 0, followUpEm: null });
    });
    it("reserva perdida (outra rodada pegou) não envia", async () => {
        m.convs = [linha("5561900000001")];
        m.perderClaim = true;
        expect(await rodar()).toBe(0);
        expect(m.enviados).toEqual([]);
    });
    it("sem telefone (não dá para conferir o descadastro) não envia", async () => {
        m.convs = [linha("x", { telefone: null })];
        expect(await rodar()).toBe(0);
        expect(m.enviados).toEqual([]);
    });
    it("erro numa sessão com treino não derruba a rodada das outras", async () => {
        m.sessoes = ["s1", "s2"];
        m.treinoPor = { s1: { followUp: FU } };
        m.quebrarTreino = true;
        m.convs = [linha("5561900000002", { sessionId: "s2", ultimaIaAt: hAntes(12.5), ultimaInboundAt: hAntes(13) })];
        expect(await rodar()).toBe(1);
        expect(m.enviados[0].texto).toMatch(/^Oi, Ana! Passando pra ver/);
    });
    it("respeita MAX_POR_RODADA (5) e o limite do dia (40)", async () => {
        m.convs = Array.from({ length: 8 }, (_, i) => linha(`55619000000${10 + i}`));
        expect(await rodar()).toBe(5);
        for (const c of m.convs) Object.assign(c, { followUpEnvios: 0, followUpEm: null });
        m.enviados = [];
        m.feitosHoje = 38;
        expect(await rodar()).toBe(2);
        m.feitosHoje = 40;
        expect(await rodar()).toBe(0);
    });
    it("no máximo um follow-up por conversa por rodada", async () => {
        m.convs = [linha("5561900000001", { ultimaIaAt: hAntes(13), ultimaInboundAt: hAntes(14) })];
        m.treino = { followUp: { maxMensagens: 5, intervaloHoras: 1, textos: ["a", "b", "c"] } };
        expect(await rodar()).toBe(1);
        expect(m.enviados.map((e) => e.texto)).toEqual(["a"]);
    });
    it("sessão sem treino (usarAtendenteNovo null) segue o caminho legado: texto padrão do salão, sem mexer em followUpEnvios", async () => {
        m.treino = null;
        m.convs = [linha("5561900000001", { ultimaIaPerguntou: true, ultimaIaAt: hAntes(12.5), ultimaInboundAt: hAntes(13) })];
        expect(await rodar()).toBe(1);
        expect(m.enviados[0].texto).toMatch(/^Oi, Ana! Passando pra ver se você conseguiu decidir/);
        expect(m.convs[0]).toMatchObject({ followUpEnvios: 0, ultimaIaPerguntou: false, followUpEm: expect.any(Date) });
    });
});
