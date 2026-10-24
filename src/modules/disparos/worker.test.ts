import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const h = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));
vi.mock("@/lib/optout", () => ({ isOptedOut: vi.fn() }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));
vi.mock("@/modules/whatsapp/provider", () => ({ getProvider: vi.fn() }));

import { ESPERA_RETENTATIVA_MS, MAX_TENTATIVAS, processarCampanhas, type LinhaEnvio, type WorkerDeps } from "./worker";
import { JITTER_CAMPANHA_MS, RODAPE_SAIR, TETO_CAMPANHA, VALIDADE_CAMPANHA_MS, chaveDoCliente, proximaJanela } from "./regras";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGORA = Date.parse("2026-10-24T15:00:00Z"); // 12:00 em São Paulo
const MIN = 60_000;
const H = 60 * MIN;

interface Envio extends LinhaEnvio { estado: string; motivo?: string | null; proximaTentativaEm: Date; enviadoEm: Date | null }
interface Camp { id: string; estado: string; texto: string; barracaNome: string; criadoEm: Date }

function cenario(
    opts: { envios?: Partial<Envio>[]; campanhas?: Camp[]; conectadas?: string[]; vinculoCriadoHaDias?: number; enviadosAntes?: Partial<Envio>[]; agora?: number } = {}
) {
    const agora = opts.agora ?? AGORA;
    const envios: Envio[] = (opts.envios ?? [{}]).map((e, i) => ({
        id: `e${i}`, campanhaId: "c0", barracaId: A, chave: chaveDoCliente(A, "5561999990001"), tentativas: 0, estado: "pendente",
        proximaTentativaEm: new Date(agora - 1000), enviadoEm: null, payload: { telefone: "5561999990001", nome: "Ana Souza" }, ...e,
    }));
    for (const [i, e] of (opts.enviadosAntes ?? []).entries()) {
        envios.push({ id: `antes${i}`, campanhaId: "cx", barracaId: A, chave: `outra${i}`, tentativas: 1, estado: "enviado", proximaTentativaEm: new Date(0), enviadoEm: new Date(agora - 5 * H), payload: null, ...e });
    }
    const campanhas: Camp[] = opts.campanhas ?? [{ id: "c0", estado: "em_andamento", texto: "Oi {nome}, promoção na {barraca}!", barracaNome: "Loja", criadoEm: new Date(agora - H) }];
    const sessoes: Record<string, string> = { [A]: "sessao-A", [B]: "sessao-B" };
    const criado = new Date(agora - (opts.vinculoCriadoHaDias ?? 30) * 24 * H);
    const casa = (where: Record<string, unknown>, row: Record<string, unknown>) =>
        Object.entries(where).every(([k, v]) => {
            if (v && typeof v === "object" && !(v instanceof Date)) {
                const o = v as { gte?: Date; lte?: Date };
                if (o.gte) return row[k] != null && (row[k] as Date).getTime() >= o.gte.getTime();
                if (o.lte) return row[k] != null && (row[k] as Date).getTime() <= o.lte.getTime();
            }
            return row[k] === v;
        });
    const db = {
        disparoEnvio: {
            findMany: async (a: { where: Record<string, unknown> }) => envios.filter((e) => casa(a.where, e as never)).map((e) => ({ ...e })),
            updateMany: async (a: { where: Record<string, unknown>; data: Partial<Envio> }) => {
                const alvo = envios.filter((e) => casa(a.where, e as never));
                alvo.forEach((e) => Object.assign(e, a.data));
                return { count: alvo.length };
            },
            update: async (a: { where: { id: string }; data: Partial<Envio> }) => Object.assign(envios.find((x) => x.id === a.where.id)!, a.data),
            count: async (a: { where: Record<string, unknown> }) => envios.filter((e) => casa(a.where, e as never)).length,
        },
        disparoCampanha: {
            findUnique: async (a: { where: { id: string } }) => campanhas.find((c) => c.id === a.where.id) ?? null,
            updateMany: async (a: { where: { id: string; estado: string }; data: Partial<Camp> }) => {
                const alvo = campanhas.filter((c) => c.id === a.where.id && c.estado === a.where.estado);
                alvo.forEach((c) => Object.assign(c, a.data));
                return { count: alvo.length };
            },
        },
        barracaSessao: { findFirst: async (a: { where: { barracaId: string } }) => ({ sessionId: sessoes[a.where.barracaId], createdAt: criado }) },
    };
    const enviadas: { jid: string; texto: string }[] = [];
    const sendText = vi.fn(async (jid: string, texto: string) => {
        enviadas.push({ jid, texto });
        return { messageId: null };
    });
    const provider = { isConnected: () => true, resolveRecipient: vi.fn(async (j: string) => j), sendText };
    const sleep = vi.fn(async () => {});
    const isOptedOut = vi.fn(async () => false);
    const deps: Partial<WorkerDeps> = {
        db: db as never, now: () => agora, sleep, random: () => 0,
        estaConectada: (s) => (opts.conectadas ?? ["sessao-A", "sessao-B"]).includes(s),
        getProvider: () => provider as never, isOptedOut, logger: h.logger,
    };
    return { envios, campanhas, enviadas, deps, provider, sleep, isOptedOut, sendText };
}

beforeEach(() => Object.values(h.logger).forEach((f) => f.mockReset()));

describe("worker de campanhas: ordem de decisão", () => {
    it("campanha cancelada: cancelado, sem envio e sem payload", async () => {
        const c = cenario({ campanhas: [{ id: "c0", estado: "cancelada", texto: "t", barracaNome: "L", criadoEm: new Date(AGORA - H) }] });
        await processarCampanhas(c.deps);
        expect(c.envios[0]).toMatchObject({ estado: "cancelado" });
        expect(c.envios[0].payload).toBe(Prisma.DbNull);
        expect(c.sendText).not.toHaveBeenCalled();
    });

    it("passou de 24 h da criação: expirado, e a campanha vira expirada", async () => {
        const c = cenario({ campanhas: [{ id: "c0", estado: "em_andamento", texto: "t", barracaNome: "L", criadoEm: new Date(AGORA - VALIDADE_CAMPANHA_MS - MIN) }] });
        await processarCampanhas(c.deps);
        expect(c.envios[0]).toMatchObject({ estado: "expirado" });
        expect(c.campanhas[0].estado).toBe("expirada");
        expect(c.sendText).not.toHaveBeenCalled();
    });

    it("fora da janela horária: adia até as 9h de São Paulo, sem enviar", async () => {
        const noite = Date.parse("2026-10-24T23:30:00Z"); // 20:30 em São Paulo
        const c = cenario({ agora: noite });
        await processarCampanhas(c.deps);
        expect(c.envios[0].estado).toBe("pendente");
        expect(c.envios[0].proximaTentativaEm.getTime()).toBe(proximaJanela(noite));
        expect(c.sendText).not.toHaveBeenCalled();
    });

    it("sessão desconectada: adia 60 s; perto do fim da validade vira pulado_desconectado", async () => {
        const c = cenario({ conectadas: [] });
        await processarCampanhas(c.deps);
        expect(c.envios[0]).toMatchObject({ estado: "pendente", motivo: "sessao_desconectada" });
        expect(c.envios[0].proximaTentativaEm.getTime()).toBe(AGORA + MIN);
        const tarde = cenario({ conectadas: [], campanhas: [{ id: "c0", estado: "em_andamento", texto: "t", barracaNome: "L", criadoEm: new Date(AGORA - VALIDADE_CAMPANHA_MS + 30_000) }] });
        await processarCampanhas(tarde.deps);
        expect(tarde.envios[0].estado).toBe("pulado_desconectado");
        expect(tarde.envios[0].payload).toBe(Prisma.DbNull);
    });

    it("teto por minuto: adia 60 s", async () => {
        const c = cenario({ enviadosAntes: Array.from({ length: TETO_CAMPANHA.minuto }, () => ({ enviadoEm: new Date(AGORA - 10_000) })) });
        await processarCampanhas(c.deps);
        expect(c.envios[0]).toMatchObject({ estado: "pendente", motivo: "teto_por_minuto" });
        expect(c.envios[0].proximaTentativaEm.getTime()).toBe(AGORA + MIN);
        expect(c.sendText).not.toHaveBeenCalled();
    });

    it("teto diário (número novo: 20): adia até a próxima janela", async () => {
        const c = cenario({ vinculoCriadoHaDias: 2, enviadosAntes: Array.from({ length: TETO_CAMPANHA.diaNovo }, () => ({})) });
        await processarCampanhas(c.deps);
        expect(c.envios[0]).toMatchObject({ estado: "pendente", motivo: "teto_diario" });
        expect(c.envios[0].proximaTentativaEm.getTime()).toBe(proximaJanela(AGORA));
    });

    it("número com mais de uma semana tem teto maior que o novo", async () => {
        const c = cenario({ vinculoCriadoHaDias: 30, enviadosAntes: Array.from({ length: TETO_CAMPANHA.diaNovo }, () => ({})) });
        await processarCampanhas(c.deps);
        expect(c.envios[0].estado).toBe("enviado");
    });

    it("cliente descadastrado depois da criação: pulado_optout, nada enviado", async () => {
        const c = cenario();
        c.isOptedOut.mockResolvedValue(true);
        await processarCampanhas(c.deps);
        expect(c.envios[0]).toMatchObject({ estado: "pulado_optout" });
        expect(c.envios[0].payload).toBe(Prisma.DbNull);
        expect(c.sendText).not.toHaveBeenCalled();
    });

    it("cliente que já recebeu campanha nas últimas 24 h (outra campanha): pulado_limite_diario", async () => {
        const c = cenario({ enviadosAntes: [{ chave: chaveDoCliente(A, "5561999990001"), enviadoEm: new Date(AGORA - 3 * H) }] });
        await processarCampanhas(c.deps);
        expect(c.envios[0]).toMatchObject({ estado: "pulado_limite_diario" });
        expect(c.sendText).not.toHaveBeenCalled();
    });

    it("mensagem de campanha de mais de 24 h atrás não bloqueia", async () => {
        const c = cenario({ enviadosAntes: [{ chave: chaveDoCliente(A, "5561999990001"), enviadoEm: new Date(AGORA - 25 * H) }] });
        await processarCampanhas(c.deps);
        expect(c.envios[0].estado).toBe("enviado");
    });

    it("mesmo telefone em outra loja não conta como já recebido", async () => {
        const c = cenario({ enviadosAntes: [{ barracaId: B, chave: chaveDoCliente(B, "5561999990001"), enviadoEm: new Date(AGORA - H) }] });
        await processarCampanhas(c.deps);
        expect(c.envios[0].estado).toBe("enviado");
    });
});

describe("worker de campanhas: envio", () => {
    it("envia com jitter, rodapé e {nome} preenchido; limpa o payload e fecha a campanha", async () => {
        const c = cenario();
        c.deps.random = () => 0.5;
        await processarCampanhas(c.deps);
        const esperado = JITTER_CAMPANHA_MS.min + Math.floor(0.5 * (JITTER_CAMPANHA_MS.max - JITTER_CAMPANHA_MS.min + 1));
        expect(c.sleep).toHaveBeenCalledWith(esperado);
        expect(c.enviadas).toHaveLength(1);
        expect(c.enviadas[0].jid).toBe("5561999990001@s.whatsapp.net");
        expect(c.enviadas[0].texto.startsWith("Oi Ana, promoção na Loja!")).toBe(true);
        expect(c.enviadas[0].texto.endsWith(RODAPE_SAIR)).toBe(true);
        expect(c.envios[0]).toMatchObject({ estado: "enviado", tentativas: 1 });
        expect(c.envios[0].payload).toBe(Prisma.DbNull);
        expect(c.envios[0].enviadoEm?.getTime()).toBe(AGORA);
        expect(c.campanhas[0].estado).toBe("concluida");
    });

    it("sem nome cadastrado não deixa 'Oi !' na mensagem", async () => {
        const c = cenario({ envios: [{ payload: { telefone: "5561999990001", nome: null } }], campanhas: [{ id: "c0", estado: "em_andamento", texto: "Olá {nome}! Temos oferta.", barracaNome: "Loja", criadoEm: new Date(AGORA - H) }] });
        await processarCampanhas(c.deps);
        expect(c.enviadas[0].texto).not.toContain("Olá !");
        expect(c.enviadas[0].texto.startsWith("Olá! Temos oferta.")).toBe(true);
    });

    it("a campanha continua em andamento enquanto restam envios pendentes", async () => {
        const c = cenario({ envios: [{}, { chave: "outro", payload: { telefone: "5561988880002", nome: null }, proximaTentativaEm: new Date(AGORA + H) }] });
        await processarCampanhas(c.deps);
        expect(c.envios[0].estado).toBe("enviado");
        expect(c.envios[1].estado).toBe("pendente");
        expect(c.campanhas[0].estado).toBe("em_andamento");
    });

    it("duas campanhas com o mesmo cliente: só a primeira envia", async () => {
        const chave = chaveDoCliente(A, "5561999990001");
        const c = cenario({
            envios: [{ id: "a", campanhaId: "c0", chave }, { id: "b", campanhaId: "c1", chave }],
            campanhas: [
                { id: "c0", estado: "em_andamento", texto: "um", barracaNome: "L", criadoEm: new Date(AGORA - H) },
                { id: "c1", estado: "em_andamento", texto: "dois", barracaNome: "L", criadoEm: new Date(AGORA - H) },
            ],
        });
        await processarCampanhas(c.deps);
        expect(c.enviadas).toHaveLength(1);
        expect(c.envios.map((e) => e.estado).sort()).toEqual(["enviado", "pulado_limite_diario"]);
    });

    it("falha de envio: retenta com espera crescente e termina em falhou", async () => {
        const c = cenario();
        c.sendText.mockRejectedValue(new Error("rede 5561999990001"));
        await processarCampanhas(c.deps);
        expect(c.envios[0]).toMatchObject({ estado: "pendente", tentativas: 1, motivo: "erro_envio" });
        expect(c.envios[0].proximaTentativaEm.getTime()).toBe(AGORA + ESPERA_RETENTATIVA_MS[0]);
        c.envios[0].tentativas = MAX_TENTATIVAS - 1;
        c.envios[0].proximaTentativaEm = new Date(AGORA - 1);
        await processarCampanhas(c.deps);
        expect(c.envios[0]).toMatchObject({ estado: "falhou", motivo: "erro_envio" });
        expect(c.envios[0].payload).toBe(Prisma.DbNull);
    });

    it("número sem WhatsApp: falhou sem retentativa", async () => {
        const c = cenario();
        c.provider.resolveRecipient.mockRejectedValue(new Error("O número não possui WhatsApp"));
        await processarCampanhas(c.deps);
        expect(c.envios[0]).toMatchObject({ estado: "falhou", motivo: "numero_sem_whatsapp" });
    });

    it("reserva impede dois workers no mesmo envio", async () => {
        const c = cenario();
        const [a, b] = await Promise.all([processarCampanhas(c.deps), processarCampanhas(c.deps)]);
        expect(a + b).toBe(1);
        expect(c.enviadas).toHaveLength(1);
    });

    it("nenhum log contém telefone, nome ou texto", async () => {
        const c = cenario();
        await processarCampanhas(c.deps);
        const c2 = cenario();
        c2.sendText.mockRejectedValue(new Error("falha com 5561999990001"));
        await processarCampanhas(c2.deps);
        const logs = JSON.stringify(Object.values(h.logger).flatMap((f) => f.mock.calls));
        for (const proibido of ["5561999990001", "Ana", "promoção", "Souza"]) expect(logs).not.toContain(proibido);
    });
});
