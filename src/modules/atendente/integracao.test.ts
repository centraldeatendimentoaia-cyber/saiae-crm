import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- banco em memória (o que o agente do salão e o ramo novo usam)
const mailer = vi.hoisted(() => ({ sendMail: vi.fn(async (_m: { to: string; subject: string; text: string }) => true) }));
vi.mock("@/lib/mailer", () => ({ sendMail: mailer.sendMail }));

const db = vi.hoisted(() => {
    const convs = new Map<string, Record<string, any>>();
    const key = (w: any) => `${w.sessionId_jid.sessionId}|${w.sessionId_jid.jid}`;
    const estado = {
        barraca: false,
        config: null as Record<string, any> | null,
        historico: [] as { fromMe: boolean; content: string }[],
        convs,
        treino: null as unknown,
        erroTreino: false,
        erroVenda: false,
    };
    const prisma = {
        agenteConfig: { findUnique: vi.fn(async () => estado.config) },
        session: { findUnique: vi.fn(async () => ({ id: "db-1" })) },
        barracaSessao: { findUnique: vi.fn(async () => (estado.barraca ? { id: "b1" } : null)) },
        message: { findMany: vi.fn(async () => [...estado.historico].reverse()) },
        label: { findFirst: vi.fn(async ({ where }: any) => ({ id: `${where.sessionId}:L-${where.name}`, name: where.name })) },
        chatLabel: { upsert: vi.fn(async () => ({})) },
        mensagemOrigem: { upsert: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
        atendenteTreino: {
            findUnique: vi.fn(async () => {
                if (estado.erroTreino) throw new Error("banco fora");
                return estado.treino ? { sessionId: "x", publicadoVersao: 1 } : null;
            }),
        },
        atendenteVersao: { findUnique: vi.fn(async () => (estado.treino ? { conteudo: estado.treino } : null)) },
        vendaIA: {
            create: vi.fn(async ({ data }: any) => {
                if (estado.erroVenda) throw new Error("banco fora");
                return { id: "v1", ...data };
            }),
        },
        agenteConversa: {
            findUnique: vi.fn(async ({ where }: any) => convs.get(where.sessionId_jid ? key(where) : [...convs.keys()].find((k) => convs.get(k)!.id === where.id) ?? "") ?? null),
            upsert: vi.fn(async ({ where, create, update }: any) => {
                const k = key(where);
                const atual = convs.get(k);
                const novo = atual ? { ...atual, ...update } : { id: `c${convs.size + 1}`, estado: "ia", pausadaAte: null, ultimaInboundAt: null, ultimaIaAt: null, ultimaIaPerguntou: false, ultimaHumanoAt: null, followUpEm: null, ...create };
                convs.set(k, novo);
                return novo;
            }),
            update: vi.fn(async ({ where, data }: any) => {
                const k = where.sessionId_jid ? key(where) : [...convs.keys()].find((x) => convs.get(x)!.id === where.id)!;
                const novo = { ...convs.get(k)!, ...data };
                convs.set(k, novo);
                return novo;
            }),
        },
    };
    return { estado, prisma };
});
vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));
vi.mock("@/lib/optout", async (orig) => ({ ...(await orig<typeof import("@/lib/optout")>()), isOptedOut: vi.fn(async () => false) }));

// Espiões nos dois motores, mantendo o comportamento real.
const motores = vi.hoisted(() => ({ salao: null as any, atendente: null as any }));
vi.mock("@/modules/agente-salao/motor", async (orig) => {
    const m = await orig<typeof import("@/modules/agente-salao/motor")>();
    motores.salao = vi.fn(m.responderSalao);
    return { ...m, responderSalao: motores.salao };
});
vi.mock("./motor", async (orig) => {
    const m = await orig<typeof import("./motor")>();
    motores.atendente = vi.fn(m.responderAtendente);
    return { ...m, responderAtendente: motores.atendente };
});

import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import type { Llm, SaidaLlm } from "@/modules/ia-atendimento/llm";
import { bindAgenteSalao, limparCacheConfigAgente } from "@/modules/agente-salao/agente";
import { _zerarEnviados } from "@/modules/agente-salao/enviados";
import { limparCacheBarraca } from "@/modules/agente-salao/barraca";
import { limparCacheAtendente, registrarVenda, usarAtendenteNovo } from "./integracao";
import { MODELOS } from "./modelos-prontos";
import { MSG_AVISO_FALHOU } from "./motor";

const SESSAO = "sessao-salao";
const GRUPO = "120363000000000000@g.us";
const CLIENTE = "5561999990001@s.whatsapp.net";
const T0 = new Date("2026-10-13T13:00:00Z"); // terça 10h em Brasília
const TREINO = MODELOS.agencia;

function montar(llmPassos: SaidaLlm[] = [{ texto: "Temos o Plano Básico. Quer saber mais?", chamadas: [] }]) {
    const handlers: Record<string, (e: any) => Promise<void>> = {};
    const enviados: { jid: string; texto: string }[] = [];
    const sock = {
        ev: { on: (n: string, h: (e: any) => Promise<void>) => { handlers[n] = h; } },
        sendMessage: vi.fn(async (jid: string, c: { text: string }) => { enviados.push({ jid, texto: c.text }); return {}; }),
        sendPresenceUpdate: vi.fn(async () => undefined),
        addChatLabel: vi.fn(async () => undefined),
    } as unknown as WASocket;
    let i = 0;
    const llm: Llm = { responder: vi.fn(async () => llmPassos[Math.min(i++, llmPassos.length - 1)]) };
    bindAgenteSalao(sock, SESSAO, { llm, debounceMs: 7000, rapido: true });
    const msg = (texto: string, over: { fromMe?: boolean; id?: string } = {}): WAMessage => ({
        key: { remoteJid: CLIENTE, fromMe: over.fromMe ?? false, id: over.id ?? `M${Math.random()}` },
        messageTimestamp: Math.floor(Date.now() / 1000),
        pushName: "Ana",
        message: { conversation: texto },
    }) as unknown as WAMessage;
    const emitir = (m: WAMessage, type = "notify") => handlers["messages.upsert"]({ messages: [m], type });
    return { sock, llm, enviados, msg, emitir };
}

const esperar = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const conversa = () => [...db.estado.convs.values()][0];

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    limparCacheConfigAgente();
    limparCacheBarraca();
    limparCacheAtendente();
    _zerarEnviados();
    db.estado.barraca = false;
    db.estado.treino = null;
    db.estado.erroTreino = false;
    db.estado.erroVenda = false;
    db.estado.convs.clear();
    db.estado.historico = [];
    db.estado.config = { ativo: true, nome: "Lavínia", conhecimento: null, promocoes: null, linkAgendamento: "https://agendamento.avec.beauty/?slug=lavi-concept", grupoRecepcaoJid: GRUPO, etiquetaAguardando: "Aguardando resposta", numerosIgnorados: [], followUpHoras: 12, pausaHoras: 12, diasAbertos: "2,3,4,5,6", horaAbre: 9, horaFecha: 18 };
    process.env.AGENTE_SALAO = "";
    for (const f of [motores.salao, motores.atendente, db.prisma.atendenteTreino.findUnique, db.prisma.vendaIA.create]) f.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("usarAtendenteNovo", () => {
    it("sem treino publicado devolve null (o motor legado continua)", async () => {
        expect(await usarAtendenteNovo(SESSAO)).toBeNull();
    });

    it("com treino publicado devolve o treino", async () => {
        db.estado.treino = TREINO;
        expect(await usarAtendenteNovo(SESSAO)).toEqual(TREINO);
    });

    it("guarda o resultado por 30 s e depois busca de novo", async () => {
        db.estado.treino = TREINO;
        await usarAtendenteNovo(SESSAO);
        vi.setSystemTime(T0.getTime() + 29_000);
        await usarAtendenteNovo(SESSAO);
        expect(db.prisma.atendenteTreino.findUnique).toHaveBeenCalledTimes(1);
        db.estado.treino = null;
        vi.setSystemTime(T0.getTime() + 30_001);
        expect(await usarAtendenteNovo(SESSAO)).toBeNull();
        expect(db.prisma.atendenteTreino.findUnique).toHaveBeenCalledTimes(2);
    });

    it("guarda também o resultado negativo; limparCacheAtendente força nova busca", async () => {
        expect(await usarAtendenteNovo(SESSAO)).toBeNull();
        db.estado.treino = TREINO;
        expect(await usarAtendenteNovo(SESSAO)).toBeNull();
        limparCacheAtendente(SESSAO);
        expect(await usarAtendenteNovo(SESSAO)).toEqual(TREINO);
    });

    it("sessão de barraca do Sai aê sempre usa o legado, mesmo com treino", async () => {
        db.estado.barraca = true;
        db.estado.treino = TREINO;
        expect(await usarAtendenteNovo(SESSAO)).toBeNull();
        expect(db.prisma.atendenteTreino.findUnique).not.toHaveBeenCalled();
    });

    it("erro de banco devolve null sem guardar, e a próxima mensagem tenta de novo", async () => {
        db.estado.treino = TREINO;
        db.estado.erroTreino = true;
        expect(await usarAtendenteNovo(SESSAO)).toBeNull();
        db.estado.erroTreino = false;
        expect(await usarAtendenteNovo(SESSAO)).toEqual(TREINO);
    });
});

describe("registrarVenda", () => {
    it("grava a venda", async () => {
        expect(await registrarVenda(SESSAO, CLIENTE, { descricao: "Plano Básico", valorCentavos: 90000 })).toBe(true);
        expect(db.prisma.vendaIA.create).toHaveBeenCalledWith({ data: { sessionId: SESSAO, jid: CLIENTE, descricao: "Plano Básico", valorCentavos: 90000 } });
    });

    it("não lança em erro de banco", async () => {
        db.estado.erroVenda = true;
        await expect(registrarVenda(SESSAO, CLIENTE, { descricao: "Plano Básico" })).resolves.toBe(false);
    });

    it("recusa descrição vazia e valor que não é inteiro >= 0, sem gravar", async () => {
        expect(await registrarVenda(SESSAO, CLIENTE, { descricao: "   " })).toBe(false);
        expect(await registrarVenda(SESSAO, CLIENTE, { descricao: "x", valorCentavos: -1 })).toBe(false);
        expect(await registrarVenda(SESSAO, CLIENTE, { descricao: "x", valorCentavos: 1.5 })).toBe(false);
        expect(db.prisma.vendaIA.create).not.toHaveBeenCalled();
    });
});

describe("ramo do agente do salão", () => {
    it("sessão sem treino chama responderSalao como antes e não toca no motor novo", async () => {
        const t = montar([{ texto: "A escova custa R$ 50. Quer agendar?", chamadas: [] }]);
        await t.emitir(t.msg("quanto é a escova?"));
        await esperar(8000);
        expect(motores.atendente).not.toHaveBeenCalled();
        expect(motores.salao).toHaveBeenCalledTimes(1);
        const [deps, entrada] = motores.salao.mock.calls[0];
        expect(Object.keys(deps).sort()).toEqual(["historico", "llm", "logger"]);
        expect(deps.llm).toBe(t.llm);
        expect(Object.keys(entrada).sort()).toEqual(["acoes", "agora", "conhecimento", "negocio", "nome", "nomePerfil", "promocoes", "salaoAberto", "textoCliente"]);
        expect(entrada).toMatchObject({ nome: "Lavínia", nomePerfil: "Ana", salaoAberto: true, textoCliente: "quanto é a escova?" });
        expect(Object.keys(entrada.acoes).sort()).toEqual(["chamarRecepcao", "etiquetar", "etiquetasPermitidas", "linkAgendamento"]);
        expect(t.enviados).toEqual([{ jid: CLIENTE, texto: "A escova custa R$ 50. Quer agendar?" }]);
    });

    it("sessão com treino publicado responde pelo motor novo, pelo mesmo envio", async () => {
        db.estado.treino = TREINO;
        const t = montar();
        await t.emitir(t.msg("quanto custa?"));
        await esperar(8000);
        expect(motores.salao).not.toHaveBeenCalled();
        expect(motores.atendente).toHaveBeenCalledTimes(1);
        const [deps, entrada] = motores.atendente.mock.calls[0];
        expect(deps.treino).toEqual(TREINO);
        expect(entrada).toMatchObject({ texto: "quanto custa?", primeiraResposta: true, mensagensSemAvancar: 1, atendimentoHumanoAberto: true, nomePerfil: "Ana" });
        expect(t.enviados).toEqual([{ jid: CLIENTE, texto: "Temos o Plano Básico. Quer saber mais?" }]);
        expect(conversa().ultimaIaPerguntou).toBe(true);
    });

    it("passar_para_pessoa reaproveita chamarRecepcao: aviso no grupo, etiqueta Aguardando e IA pausada", async () => {
        db.estado.treino = TREINO;
        const t = montar([
            { texto: "", chamadas: [{ id: "1", nome: "passar_para_pessoa", argumentos: { motivo: "pedido-humano", nome: "Ana", interesse: "site", resumo: "quer falar com alguém" } }] },
            { texto: "ignorado", chamadas: [] },
        ]);
        await t.emitir(t.msg("preciso de ajuda com uma coisa específica"));
        await esperar(8000);
        const grupo = t.enviados.filter((e) => e.jid === GRUPO);
        expect(grupo).toHaveLength(1);
        expect(grupo[0].texto).toContain("Cliente aguardando resposta - bot");
        expect(grupo[0].texto).toContain("Motivo: pediu humano");
        expect(grupo[0].texto).toContain("Serviço: site");
        expect(t.sock.addChatLabel).toHaveBeenCalledWith(CLIENTE, "L-Aguardando resposta");
        expect(conversa()).toMatchObject({ estado: "humano", motivoPausa: "pediu_humano" });
        const frase = TREINO.gatilhos.find((g) => g.id === "pedido-humano")!.frase;
        expect(t.enviados.filter((e) => e.jid === CLIENTE).map((e) => e.texto)).toEqual([frase]);
        expect(conversa().ultimaIaPerguntou).toBe(false);
    });

    it("pessoa assumiu a conversa: o motor novo não é chamado", async () => {
        db.estado.treino = TREINO;
        const t = montar();
        await t.emitir(t.msg("Oi, é a recepção", { fromMe: true, id: "H1" }));
        await t.emitir(t.msg("tá bom"));
        await esperar(8000);
        expect(motores.atendente).not.toHaveBeenCalled();
        expect(t.enviados).toEqual([]);
    });

    it("aviso à equipe falhou: não pausa, mas etiqueta Aguardando para a conversa não sumir", async () => {
        db.estado.treino = TREINO;
        db.estado.config!.grupoRecepcaoJid = null;
        const t = montar([{ texto: "", chamadas: [{ id: "1", nome: "passar_para_pessoa", argumentos: { motivo: "reclamacao" } }] }, { texto: "Chamei a gerente!", chamadas: [] }]);
        await t.emitir(t.msg("quero reclamar"));
        await esperar(8000);
        expect(conversa().estado).toBe("ia");
        expect(t.sock.addChatLabel).toHaveBeenCalledWith(CLIENTE, "L-Aguardando resposta");
        expect(t.enviados).toEqual([{ jid: CLIENTE, texto: MSG_AVISO_FALHOU }]);
    });

    it("registrar_venda grava VendaIA da conversa", async () => {
        db.estado.treino = TREINO;
        const t = montar([
            { texto: "", chamadas: [{ id: "1", nome: "registrar_venda", argumentos: { descricao: "Plano Básico", valor_centavos: 90000 } }] },
            { texto: "Fechado! Bem-vinda.", chamadas: [] },
        ]);
        await t.emitir(t.msg("fechado, quero o básico"));
        await esperar(8000);
        expect(db.prisma.vendaIA.create).toHaveBeenCalledWith({ data: { sessionId: SESSAO, jid: CLIENTE, descricao: "Plano Básico", valorCentavos: 90000 } });
        expect(t.enviados.map((e) => e.texto)).toEqual(["Fechado! Bem-vinda."]);
    });
});
