import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const h = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));
vi.mock("@/lib/optout", async (orig) => ({ ...(await orig<typeof import("@/lib/optout")>()), isOptedOut: vi.fn() }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));
vi.mock("@/modules/whatsapp/provider", () => ({ getProvider: vi.fn() }));

import {
    ATRASO_AVALIACAO_MS, LIMITE_ENVIO_MS, TEXTO_AVALIACAO_PADRAO, VALIDADE_RESPOSTA_MS,
    agendarAvaliacaoDoEvento, parseNota, processarAvaliacoes, tratarRespostaAvaliacao, type AvaliacaoDeps, type RespostaDeps,
} from "./avaliacao";
import { proximaJanela } from "./regras";
import { TETO_POR_MINUTO } from "@/modules/integracao/comanda/aviso-worker";
import type { ComandaEvent } from "@/modules/integracao/comanda/schema";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGORA = Date.parse("2026-10-24T15:00:00Z"); // 12:00 em São Paulo
const MIN = 60_000;
const H = 60 * MIN;

describe("parseNota", () => {
    it.each([
        ["5", 5, null], ["nota 4", 4, null], ["Nota: 3", 3, null], ["4 estrelas", 4, null], ["1 estrela", 1, null],
        ["3 - demorou", 3, "demorou"], ["2, frio", 2, "frio"], ["5! muito bom", 5, "muito bom"], ["  4  ", 4, null],
    ])("%j vira nota %i", (texto, nota, comentario) => {
        expect(parseNota(texto)).toEqual({ nota, comentario });
    });
    it.each(["10", "0", "6", "Quero 2 pizzas", "2x yakisoba", "", "   ", "sim", "4,5", "4.5", "15 minutos", "nota"])("%j não é nota", (texto) => {
        expect(parseNota(texto)).toBeNull();
    });
    it("corta o comentário em 300 caracteres", () => {
        expect(parseNota(`5 ${"a".repeat(500)}`)!.comentario).toHaveLength(300);
    });
});

/* ------------------------------ agendamento ------------------------------ */

const ev = (type: ComandaEvent["type"], data: Record<string, unknown>, barraca = A): ComandaEvent => ({
    id: crypto.randomUUID(), type, version: 1, occurred_at: "2026-10-24T14:00:00Z", barraca_id: barraca, sequence: 1,
    data: { pedido_id: "p1", senha: 12, status: "entregue", cliente: { nome: "Ana Souza", telefone: "61999990001" }, ...data },
});

function bancoAgendar(comSessao = true) {
    const linhas: Record<string, unknown>[] = [];
    const db = {
        barracaSessao: { findFirst: async () => (comSessao ? { sessionId: "s", createdAt: new Date(0) } : null) },
        avaliacaoPedido: {
            create: async (a: { data: Record<string, unknown> }) => {
                if (linhas.some((l) => l.barracaId === a.data.barracaId && l.pedidoId === a.data.pedidoId)) throw Object.assign(new Error("dup"), { code: "P2002" });
                linhas.push(a.data);
            },
        },
    };
    return { db, linhas };
}

describe("agendarAvaliacaoDoEvento", () => {
    it("entregue agenda para 30 min depois, com telefone, nome e senha", async () => {
        const { db, linhas } = bancoAgendar();
        await agendarAvaliacaoDoEvento(ev("order.status_changed", {}), db);
        expect(linhas).toHaveLength(1);
        expect(linhas[0]).toMatchObject({ barracaId: A, pedidoId: "p1", estado: "agendada", payload: { telefone: "5561999990001", nome: "Ana Souza", senha: 12 } });
        expect((linhas[0].enviarEm as Date).getTime()).toBe(Date.parse("2026-10-24T14:00:00Z") + ATRASO_AVALIACAO_MS);
    });
    it("evento entregue duplicado não cria outra", async () => {
        const { db, linhas } = bancoAgendar();
        await agendarAvaliacaoDoEvento(ev("order.status_changed", {}), db);
        await agendarAvaliacaoDoEvento(ev("order.status_changed", {}), db);
        expect(linhas).toHaveLength(1);
    });
    it("pedido que nasce entregue não gera avaliação, nem pelo status_changed seguinte", async () => {
        const { db, linhas } = bancoAgendar();
        await agendarAvaliacaoDoEvento(ev("order.created", {}), db);
        await agendarAvaliacaoDoEvento(ev("order.status_changed", {}), db);
        expect(linhas).toHaveLength(1);
        expect(linhas[0]).toMatchObject({ estado: "pulada_desativada", motivo: "nasceu_entregue" });
        expect(linhas[0].payload).toBeUndefined();
    });
    it("sem telefone: pulada_sem_telefone, sem payload", async () => {
        const { db, linhas } = bancoAgendar();
        await agendarAvaliacaoDoEvento(ev("order.status_changed", { cliente: { nome: "Ana", telefone: null } }), db);
        expect(linhas[0]).toMatchObject({ estado: "pulada_sem_telefone" });
        expect(linhas[0].payload).toBeUndefined();
    });
    it("outros eventos e outros status são ignorados; loja sem sessão também", async () => {
        const { db, linhas } = bancoAgendar();
        await agendarAvaliacaoDoEvento(ev("order.ready", { status: "pronto" }), db);
        await agendarAvaliacaoDoEvento(ev("order.status_changed", { status: "pronto" }), db);
        await agendarAvaliacaoDoEvento(ev("order.cancelled", { status: "cancelado" }), db);
        const sem = bancoAgendar(false);
        await agendarAvaliacaoDoEvento(ev("order.status_changed", {}), sem.db);
        expect(linhas).toHaveLength(0);
        expect(sem.linhas).toHaveLength(0);
    });
    it("erro de banco que não é duplicata sobe (a rota responde 503)", async () => {
        const db = { barracaSessao: { findFirst: async () => ({ sessionId: "s", createdAt: new Date(0) }) }, avaliacaoPedido: { create: async () => { throw new Error("banco fora"); } } };
        await expect(agendarAvaliacaoDoEvento(ev("order.status_changed", {}), db)).rejects.toThrow();
    });
});

/* ------------------------------ worker de envio ------------------------------ */

interface Av {
    id: string; barracaId: string; pedidoId: string; estado: string; motivo?: string | null; tentativas: number; enviarEm: Date; ocorridoEm: Date;
    enviadaEm: Date | null; payload: unknown; nota?: number | null;
}

function cenarioWorker(opts: { avs?: Partial<Av>[]; config?: unknown; conectada?: boolean; cancelado?: boolean; agora?: number; jaEnviados?: Partial<Av>[]; optout?: boolean } = {}) {
    const agora = opts.agora ?? AGORA;
    const avs: Av[] = (opts.avs ?? [{}]).map((a, i) => ({
        id: `a${i}`, barracaId: A, pedidoId: `p${i}`, estado: "agendada", tentativas: 0, enviarEm: new Date(agora - 1000), ocorridoEm: new Date(agora - 31 * MIN), enviadaEm: null,
        payload: { telefone: "5561999990001", nome: "Ana Souza", senha: 12 }, ...a,
    }));
    for (const [i, a] of (opts.jaEnviados ?? []).entries())
        avs.push({ id: `j${i}`, barracaId: A, pedidoId: `pj${i}`, estado: "enviada", tentativas: 1, enviarEm: new Date(0), ocorridoEm: new Date(0), enviadaEm: new Date(agora - 10_000), payload: null, ...a });
    const casa = (where: Record<string, unknown>, row: Record<string, unknown>) =>
        Object.entries(where).every(([k, v]) => {
            if (v && typeof v === "object" && !(v instanceof Date)) {
                const o = v as { gte?: Date; lte?: Date; lt?: Date };
                const t = row[k] as Date | null;
                if (o.gte) return t != null && t.getTime() >= o.gte.getTime();
                if (o.lte) return t != null && t.getTime() <= o.lte.getTime();
                if (o.lt) return t != null && t.getTime() < o.lt.getTime();
            }
            return row[k] === v;
        });
    const db = {
        avaliacaoPedido: {
            findMany: async (a: { where: Record<string, unknown> }) => avs.filter((x) => casa(a.where, x as never)).map((x) => ({ ...x })),
            updateMany: async (a: { where: Record<string, unknown>; data: Partial<Av> }) => {
                const alvo = avs.filter((x) => casa(a.where, x as never));
                alvo.forEach((x) => Object.assign(x, a.data));
                return { count: alvo.length };
            },
            update: async (a: { where: { id: string }; data: Partial<Av> }) => Object.assign(avs.find((x) => x.id === a.where.id)!, a.data),
            count: async (a: { where: Record<string, unknown> }) => avs.filter((x) => casa(a.where, x as never)).length,
        },
        avisoPedido: { findFirst: async () => (opts.cancelado ? { id: "x" } : null), count: async () => 0 },
        barracaSessao: { findFirst: async () => ({ sessionId: "sessao-A", createdAt: new Date(agora - 30 * 24 * H) }) },
    };
    const sendText = vi.fn(async (..._a: unknown[]) => ({ messageId: null }));
    const provider = { isConnected: () => true, resolveRecipient: vi.fn(async (j: string) => j), sendText };
    const config = vi.fn(async () => (opts.config === undefined ? { ativo: true, texto: null, whatsapp_dono: null, barraca_nome: "Jmal" } : (opts.config as never)));
    const sleep = vi.fn(async () => {});
    const deps: Partial<AvaliacaoDeps> = {
        db: db as never, now: () => agora, sleep, random: () => 0, estaConectada: () => opts.conectada ?? true, getProvider: () => provider as never,
        isOptedOut: async () => opts.optout ?? false, config: config as never, logger: h.logger,
    };
    return { avs, deps, sendText, provider, config, sleep };
}

beforeEach(() => Object.values(h.logger).forEach((f) => f.mockReset()));

describe("worker de avaliações", () => {
    it("envia o texto padrão com nome, senha e loja; fica enviada e mantém o telefone para casar a resposta", async () => {
        const c = cenarioWorker();
        expect(await processarAvaliacoes(c.deps)).toBe(1);
        expect(c.sendText).toHaveBeenCalledOnce();
        expect(c.sendText.mock.calls[0][0]).toBe("5561999990001@s.whatsapp.net");
        expect(c.sendText.mock.calls[0][1]).toBe("Olá Ana! Como foi seu pedido #12 na Jmal? Responda com uma nota de 1 a 5 (5 = ótimo) e, se quiser, deixe um comentário.");
        expect(TEXTO_AVALIACAO_PADRAO).toContain("{senha}");
        expect(c.avs[0]).toMatchObject({ estado: "enviada", tentativas: 1 });
        expect(c.avs[0].enviadaEm?.getTime()).toBe(AGORA);
        expect(c.avs[0].payload).not.toBeNull();
    });

    it("usa o texto personalizado da loja", async () => {
        const c = cenarioWorker({ config: { ativo: true, texto: "Nota para {barraca}, {nome}?", whatsapp_dono: null, barraca_nome: "Jmal" } });
        await processarAvaliacoes(c.deps);
        expect(c.sendText.mock.calls[0][1]).toBe("Nota para Jmal, Ana?");
    });

    it("ainda não chegou a hora: não toca", async () => {
        const c = cenarioWorker({ avs: [{ enviarEm: new Date(AGORA + 5 * MIN) }] });
        expect(await processarAvaliacoes(c.deps)).toBe(0);
        expect(c.config).not.toHaveBeenCalled();
    });

    it("config indisponível: adia 5 min; passou de 6 h: falhou", async () => {
        const c = cenarioWorker({ config: null });
        await processarAvaliacoes(c.deps);
        expect(c.avs[0]).toMatchObject({ estado: "agendada", motivo: "config_indisponivel" });
        expect(c.avs[0].enviarEm.getTime()).toBe(AGORA + 5 * MIN);
        const velha = cenarioWorker({ config: null, avs: [{ ocorridoEm: new Date(AGORA - ATRASO_AVALIACAO_MS - LIMITE_ENVIO_MS - MIN) }] });
        await processarAvaliacoes(velha.deps);
        expect(velha.avs[0]).toMatchObject({ estado: "falhou", motivo: "config_indisponivel" });
        expect(velha.avs[0].payload).toBe(Prisma.DbNull);
    });

    it("avaliação desligada na hora do envio: pulada_desativada, nada enviado", async () => {
        const c = cenarioWorker({ config: { ativo: false, texto: null, whatsapp_dono: null, barraca_nome: "J" } });
        await processarAvaliacoes(c.deps);
        expect(c.avs[0]).toMatchObject({ estado: "pulada_desativada" });
        expect(c.avs[0].payload).toBe(Prisma.DbNull);
        expect(c.sendText).not.toHaveBeenCalled();
    });

    it("pedido com aviso de cancelamento: pulada_cancelado", async () => {
        const c = cenarioWorker({ cancelado: true });
        await processarAvaliacoes(c.deps);
        expect(c.avs[0].estado).toBe("pulada_cancelado");
        expect(c.sendText).not.toHaveBeenCalled();
    });

    it("cliente descadastrado: pulada_optout", async () => {
        const c = cenarioWorker({ optout: true });
        await processarAvaliacoes(c.deps);
        expect(c.avs[0].estado).toBe("pulada_optout");
        expect(c.sendText).not.toHaveBeenCalled();
    });

    it("sessão desconectada: adia; depois de 6 h: pulada_desconectada", async () => {
        const c = cenarioWorker({ conectada: false });
        await processarAvaliacoes(c.deps);
        expect(c.avs[0]).toMatchObject({ estado: "agendada", motivo: "sessao_desconectada" });
        const velha = cenarioWorker({ conectada: false, avs: [{ ocorridoEm: new Date(AGORA - ATRASO_AVALIACAO_MS - LIMITE_ENVIO_MS - MIN) }] });
        await processarAvaliacoes(velha.deps);
        expect(velha.avs[0].estado).toBe("pulada_desconectada");
    });

    it("fora da janela horária: nada é enviado e volta às 9h", async () => {
        const noite = Date.parse("2026-10-24T23:30:00Z"); // 20:30 em São Paulo
        const c = cenarioWorker({ agora: noite });
        await processarAvaliacoes(c.deps);
        expect(c.sendText).not.toHaveBeenCalled();
        expect(c.avs[0]).toMatchObject({ estado: "agendada", motivo: "fora_da_janela" });
        expect(c.avs[0].enviarEm.getTime()).toBe(proximaJanela(noite));
    });

    it("teto por minuto dos avisos vale: adia", async () => {
        const c = cenarioWorker({ jaEnviados: Array.from({ length: TETO_POR_MINUTO.normal }, () => ({})) });
        await processarAvaliacoes(c.deps);
        expect(c.avs[0]).toMatchObject({ estado: "agendada", motivo: "teto_por_minuto" });
        expect(c.sendText).not.toHaveBeenCalled();
    });

    it("falha de envio: retenta; número sem WhatsApp falha direto", async () => {
        const c = cenarioWorker();
        c.sendText.mockRejectedValue(new Error("rede"));
        await processarAvaliacoes(c.deps);
        expect(c.avs[0]).toMatchObject({ estado: "agendada", tentativas: 1, motivo: "erro_envio" });
        const sem = cenarioWorker();
        sem.provider.resolveRecipient.mockRejectedValue(new Error("O número não possui WhatsApp"));
        await processarAvaliacoes(sem.deps);
        expect(sem.avs[0]).toMatchObject({ estado: "falhou", motivo: "numero_sem_whatsapp" });
    });

    it("reserva impede dois workers na mesma avaliação", async () => {
        const c = cenarioWorker();
        const [a, b] = await Promise.all([processarAvaliacoes(c.deps), processarAvaliacoes(c.deps)]);
        expect(a + b).toBe(1);
        expect(c.sendText).toHaveBeenCalledOnce();
    });

    it("enviada há mais de 48 h sem resposta: expirada e sem telefone", async () => {
        const c = cenarioWorker({ avs: [{ estado: "enviada", enviarEm: new Date(0), enviadaEm: new Date(AGORA - VALIDADE_RESPOSTA_MS - MIN) }] });
        await processarAvaliacoes(c.deps);
        expect(c.avs[0]).toMatchObject({ estado: "expirada" });
        expect(c.avs[0].payload).toBe(Prisma.DbNull);
    });

    it("nenhum log contém telefone, nome ou texto", async () => {
        const c = cenarioWorker();
        c.sendText.mockRejectedValue(new Error("falha 5561999990001 Ana"));
        await processarAvaliacoes(c.deps);
        const logs = JSON.stringify(Object.values(h.logger).flatMap((f) => f.mock.calls));
        for (const proibido of ["5561999990001", "Ana", "Souza", "pedido"]) expect(logs).not.toContain(proibido);
    });
});

/* ------------------------------ resposta ------------------------------ */

function cenarioResposta(opts: { avs?: Partial<Av>[]; conversaAberta?: boolean; dono?: string | null; agora?: number; sessaoDeOutraLoja?: boolean } = {}) {
    const agora = opts.agora ?? AGORA;
    const avs: Av[] = (opts.avs ?? [{}]).map((a, i) => ({
        id: `a${i}`, barracaId: A, pedidoId: `p${i}`, estado: "enviada", tentativas: 1, enviarEm: new Date(0), ocorridoEm: new Date(0), enviadaEm: new Date(agora - 10 * MIN),
        payload: { telefone: "5561999990001", nome: "Ana Souza", senha: 12 }, nota: null, ...a,
    }));
    const casa = (where: Record<string, unknown>, row: Record<string, unknown>) =>
        Object.entries(where).every(([k, v]) => {
            if (v && typeof v === "object" && !(v instanceof Date)) return (row[k] as Date).getTime() >= (v as { gte: Date }).gte.getTime();
            return row[k] === v;
        });
    const db = {
        barracaSessao: { findUnique: async (a: { where: { sessionId: string } }) => (a.where.sessionId === "sessao-A" ? { barracaId: A } : a.where.sessionId === "sessao-B" ? { barracaId: B } : null) },
        avaliacaoPedido: {
            findMany: async (a: { where: Record<string, unknown> }) => avs.filter((x) => casa(a.where, x as never)).sort((x, y) => y.enviadaEm!.getTime() - x.enviadaEm!.getTime()),
            updateMany: async (a: { where: Record<string, unknown>; data: Partial<Av> }) => {
                const alvo = avs.filter((x) => x.id === a.where.id && x.estado === a.where.estado);
                alvo.forEach((x) => Object.assign(x, a.data));
                return { count: alvo.length };
            },
        },
    };
    const enviadas: { jid: string; texto: string }[] = [];
    const provider = { isConnected: () => true, resolveRecipient: vi.fn(async (j: string) => j), sendText: vi.fn(async (jid: string, texto: string) => { enviadas.push({ jid, texto }); return { messageId: null }; }) };
    const config = vi.fn(async () => ({ ativo: true, texto: null, whatsapp_dono: opts.dono === undefined ? "61988880002" : opts.dono, barraca_nome: "Jmal" }));
    const deps: Partial<RespostaDeps> = { db: db as never, now: () => agora, conversaAberta: () => opts.conversaAberta ?? false, getProvider: () => provider as never, config, logger: h.logger };
    return { avs, deps, enviadas, provider };
}

const resp = (texto: string, over: Partial<{ sessionId: string; jid: string; contactKey: string }> = {}) => ({ sessionId: "sessao-A", jid: "5561999990001@s.whatsapp.net", texto, ...over });

describe("tratarRespostaAvaliacao", () => {
    it("nota válida: grava, limpa o telefone, agradece ao cliente e avisa o dono", async () => {
        const c = cenarioResposta();
        expect(await tratarRespostaAvaliacao(resp("5 ótimo"), c.deps)).toBe(true);
        expect(c.avs[0]).toMatchObject({ estado: "respondida", nota: 5, comentario: "ótimo" });
        expect(c.avs[0].payload).toBe(Prisma.DbNull);
        expect(c.enviadas[0]).toEqual({ jid: "5561999990001@s.whatsapp.net", texto: "Obrigado pela avaliação!" });
        expect(c.enviadas[1].jid).toBe("5561988880002@s.whatsapp.net");
        expect(c.enviadas[1].texto).toBe('Avaliação de Ana (pedido #12): nota 5 de 5.\n"ótimo"');
    });

    it("nota 2: mensagem de desculpas ao cliente e aviso ao dono com ATENÇÃO", async () => {
        const c = cenarioResposta();
        expect(await tratarRespostaAvaliacao(resp("2 frio"), c.deps)).toBe(true);
        expect(c.enviadas[0].texto).toBe("Sentimos muito. Vamos avisar o responsável da loja para falar com você.");
        expect(c.enviadas[1].texto.startsWith("ATENÇÃO: ")).toBe(true);
    });

    it("duas respostas seguidas gravam só a primeira", async () => {
        const c = cenarioResposta();
        expect(await tratarRespostaAvaliacao(resp("5"), c.deps)).toBe(true);
        expect(await tratarRespostaAvaliacao(resp("1"), c.deps)).toBe(false);
        expect(c.avs[0].nota).toBe(5);
    });

    it("respostas simultâneas: só uma grava (condicional em enviada)", async () => {
        const c = cenarioResposta();
        const r = await Promise.all([tratarRespostaAvaliacao(resp("5"), c.deps), tratarRespostaAvaliacao(resp("1"), c.deps)]);
        expect(r.filter(Boolean)).toHaveLength(1);
    });

    it("bot com conversa aberta: false, sem gravar", async () => {
        const c = cenarioResposta({ conversaAberta: true });
        expect(await tratarRespostaAvaliacao(resp("5"), c.deps)).toBe(false);
        expect(c.avs[0].estado).toBe("enviada");
        expect(c.enviadas).toHaveLength(0);
    });

    it.each(["Quero 2 pizzas", "10", "0", "oi"])("%j não vira nota", async (texto) => {
        const c = cenarioResposta();
        expect(await tratarRespostaAvaliacao(resp(texto), c.deps)).toBe(false);
        expect(c.avs[0].estado).toBe("enviada");
    });

    it("telefone de outro contato ou sessão de outra loja: false", async () => {
        const c = cenarioResposta();
        expect(await tratarRespostaAvaliacao(resp("5", { jid: "5561977770003@s.whatsapp.net" }), c.deps)).toBe(false);
        expect(await tratarRespostaAvaliacao(resp("5", { sessionId: "sessao-B" }), c.deps)).toBe(false);
        expect(await tratarRespostaAvaliacao(resp("5", { sessionId: "sessao-sem-loja" }), c.deps)).toBe(false);
        expect(c.avs[0].estado).toBe("enviada");
    });

    it("com vários pedidos do mesmo cliente, responde o mais recente", async () => {
        const c = cenarioResposta({ avs: [{ pedidoId: "velho", enviadaEm: new Date(AGORA - 5 * H) }, { pedidoId: "novo", enviadaEm: new Date(AGORA - 10 * MIN) }] });
        await tratarRespostaAvaliacao(resp("4"), c.deps);
        expect(c.avs.find((a) => a.pedidoId === "novo")!.estado).toBe("respondida");
        expect(c.avs.find((a) => a.pedidoId === "velho")!.estado).toBe("enviada");
    });

    it("49 h depois: false", async () => {
        const c = cenarioResposta({ avs: [{ enviadaEm: new Date(AGORA - 49 * H) }] });
        expect(await tratarRespostaAvaliacao(resp("5"), c.deps)).toBe(false);
        expect(c.avs[0].estado).toBe("enviada");
    });

    it("casa o telefone com e sem o 9º dígito", async () => {
        const c = cenarioResposta();
        expect(await tratarRespostaAvaliacao(resp("5", { jid: "556199990001@s.whatsapp.net" }), c.deps)).toBe(true);
    });

    it("jid @lid: usa o telefone do contactKey", async () => {
        const c = cenarioResposta();
        expect(await tratarRespostaAvaliacao(resp("5", { jid: "123456789@lid", contactKey: "5561999990001" }), c.deps)).toBe(true);
        expect(c.enviadas[0].jid).toBe("123456789@lid");
    });

    it("dono sem WhatsApp cadastrado: grava, agradece e devolve true, sem erro", async () => {
        const c = cenarioResposta({ dono: null });
        expect(await tratarRespostaAvaliacao(resp("3"), c.deps)).toBe(true);
        expect(c.avs[0].estado).toBe("respondida");
        expect(c.enviadas).toHaveLength(1);
    });

    it("falha ao enviar o agradecimento ou o aviso não desfaz a nota", async () => {
        const c = cenarioResposta();
        c.provider.sendText.mockRejectedValue(new Error("rede"));
        expect(await tratarRespostaAvaliacao(resp("4"), c.deps)).toBe(true);
        expect(c.avs[0]).toMatchObject({ estado: "respondida", nota: 4 });
    });

    it("erro de banco: false e o bot segue", async () => {
        const c = cenarioResposta();
        (c.deps.db as unknown as { barracaSessao: { findUnique: () => Promise<never> } }).barracaSessao.findUnique = async () => { throw new Error("banco"); };
        expect(await tratarRespostaAvaliacao(resp("5"), c.deps)).toBe(false);
    });
});
