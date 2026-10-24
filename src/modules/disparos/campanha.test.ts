import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import { executarAcaoDisparo, validarPedidoDisparo, type DisparoDeps, type PedidoDisparo } from "./campanha";
import { chaveDoCliente } from "./regras";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGORA = Date.parse("2026-10-24T15:00:00Z");
const H = 3_600_000;
const req = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface Camp { id: string; barracaId: string; requestId: string; tipo: string; estado: string; texto: string; barracaNome: string; total: number; criadoEm: Date }
interface Env { id: string; campanhaId: string; barracaId: string; chave: string; estado: string; motivo?: string | null; payload: unknown }
interface Aval { pedidoId: string; barracaId: string; nota: number | null; comentario: string | null; respondidaEm: Date | null; enviadaEm: Date | null }

function cenario(opts: { sessoes?: Record<string, string>; conectadas?: string[]; campanhas?: Partial<Camp>[]; envios?: Partial<Env>[]; avaliacoes?: Partial<Aval>[] } = {}) {
    const sessoes = opts.sessoes ?? { [A]: "sessao-A", [B]: "sessao-B" };
    const campanhas: Camp[] = (opts.campanhas ?? []).map((c, i) => ({
        id: `c${i}`, barracaId: A, requestId: req(900 + i), tipo: "promocao", estado: "concluida", texto: "t", barracaNome: "L", total: 1, criadoEm: new Date(AGORA - 2 * H), ...c,
    }));
    const envios: Env[] = (opts.envios ?? []).map((e, i) => ({ id: `e${i}`, campanhaId: "c0", barracaId: A, chave: `k${i}`, estado: "pendente", payload: { telefone: "5561999990001", nome: null }, ...e }));
    const avaliacoes: Aval[] = (opts.avaliacoes ?? []).map((a) => ({ pedidoId: "p", barracaId: A, nota: null, comentario: null, respondidaEm: null, enviadaEm: null, ...a }));
    let seq = 0;
    const casa = (where: Record<string, unknown>, row: Record<string, unknown>) =>
        Object.entries(where).every(([k, v]) => {
            if (v && typeof v === "object" && !(v instanceof Date)) {
                const o = v as { gte?: Date; in?: unknown[]; not?: unknown };
                if (o.gte) return (row[k] as Date | null) !== null && (row[k] as Date).getTime() >= o.gte.getTime();
                if (o.in) return o.in.includes(row[k]);
                if ("not" in o) return row[k] !== o.not;
            }
            return row[k] === v;
        });
    const db: DisparoDeps["db"] = {
        barracaSessao: { findFirst: async (a) => { const id = sessoes[(a as { where: { barracaId: string } }).where.barracaId]; return id ? { sessionId: id, createdAt: new Date(0) } : null; } },
        disparoCampanha: {
            findUnique: async (a) => campanhas.find((c) => c.requestId === (a as { where: { requestId: string } }).where.requestId) ?? null,
            findMany: async (a) => campanhas.filter((c) => casa((a as { where: Record<string, unknown> }).where, c as never)).sort((x, y) => y.criadoEm.getTime() - x.criadoEm.getTime()).slice(0, (a as { take: number }).take),
            count: async (a) => campanhas.filter((c) => casa((a as { where: Record<string, unknown> }).where, c as never)).length,
            create: async (a) => {
                const d = (a as { data: Partial<Camp> }).data;
                const c = { id: `n${++seq}`, estado: "em_andamento", criadoEm: new Date(AGORA), ...d } as Camp;
                campanhas.push(c);
                return { id: c.id };
            },
            updateMany: async (a) => {
                const { where, data } = a as { where: Record<string, unknown>; data: Partial<Camp> };
                const alvo = campanhas.filter((c) => casa(where, c as never));
                alvo.forEach((c) => Object.assign(c, data));
                return { count: alvo.length };
            },
        },
        disparoEnvio: {
            createMany: async (a) => { for (const d of (a as { data: Partial<Env>[] }).data) envios.push({ id: `x${++seq}`, estado: "pendente", ...d } as Env); },
            groupBy: async (a) => {
                const w = (a as { where: { barracaId: string; campanhaId: { in: string[] } } }).where;
                const mapa = new Map<string, number>();
                for (const e of envios.filter((x) => x.barracaId === w.barracaId && w.campanhaId.in.includes(x.campanhaId))) mapa.set(`${e.campanhaId}|${e.estado}`, (mapa.get(`${e.campanhaId}|${e.estado}`) ?? 0) + 1);
                return [...mapa].map(([k, n]) => ({ campanhaId: k.split("|")[0], estado: k.split("|")[1], _count: { _all: n } }));
            },
            updateMany: async (a) => {
                const { where, data } = a as { where: Record<string, unknown>; data: Partial<Env> };
                const alvo = envios.filter((e) => casa(where, e as never));
                alvo.forEach((e) => Object.assign(e, data));
                return { count: alvo.length };
            },
        },
        avaliacaoPedido: {
            aggregate: async (a) => {
                const l = avaliacoes.filter((x) => casa((a as { where: Record<string, unknown> }).where, x as never));
                const notas = l.map((x) => x.nota!);
                return { _avg: { nota: notas.length ? notas.reduce((s, n) => s + n, 0) / notas.length : null }, _count: { nota: notas.length } };
            },
            count: async (a) => avaliacoes.filter((x) => casa((a as { where: Record<string, unknown> }).where, x as never)).length,
            findMany: async (a) => avaliacoes.filter((x) => casa((a as { where: Record<string, unknown> }).where, x as never)).slice(0, (a as { take: number }).take),
        },
    };
    const acordar = vi.fn();
    const deps: Partial<DisparoDeps> = { db, now: () => AGORA, estaConectada: (s) => (opts.conectadas ?? ["sessao-A", "sessao-B"]).includes(s), acordar };
    return { campanhas, envios, deps, acordar };
}

const criar = (over: Record<string, unknown> = {}): Extract<PedidoDisparo, { acao: "criar" }> => ({
    barraca_id: A, request_id: req(1), acao: "criar", tipo: "promocao", texto: "Oi {nome}!", barraca_nome: "Loja",
    destinatarios: [{ telefone: "61999990001", nome: "Ana" }], ...over,
}) as never;

describe("criar campanha", () => {
    it("registra campanha e um envio por telefone único normalizado, sem duplicados e inválidos", async () => {
        const c = cenario();
        const r = await executarAcaoDisparo(
            criar({ destinatarios: [{ telefone: "61999990001", nome: "Ana" }, { telefone: "5561999990001", nome: "Ana de novo" }, { telefone: "123456789", nome: null }, { telefone: "61988880002", nome: null }] }),
            c.deps
        );
        expect(r).toMatchObject({ ok: true, total: 2, invalidos: 1, repetido: false });
        expect(c.envios).toHaveLength(2);
        expect(c.envios[0].payload).toEqual({ telefone: "5561999990001", nome: "Ana" });
        expect(c.envios[0].chave).toBe(chaveDoCliente(A, "5561999990001"));
        expect(c.campanhas[0]).toMatchObject({ barracaId: A, estado: "em_andamento", total: 2 });
        expect(c.acordar).toHaveBeenCalledOnce();
    });

    it("corta o nome em 60 caracteres no payload", async () => {
        const c = cenario();
        await executarAcaoDisparo(criar({ destinatarios: [{ telefone: "61999990001", nome: "N".repeat(80) }] }), c.deps);
        expect((c.envios[0].payload as { nome: string }).nome).toHaveLength(60);
    });

    it("mesmo request_id devolve repetido sem novos envios", async () => {
        const c = cenario();
        const a = await executarAcaoDisparo(criar(), c.deps);
        const b = await executarAcaoDisparo(criar(), c.deps);
        expect(b).toMatchObject({ ok: true, repetido: true, total: 1 });
        expect((b as { campanha_id: string }).campanha_id).toBe((a as { campanha_id: string }).campanha_id);
        expect(c.envios).toHaveLength(1);
        expect(c.campanhas).toHaveLength(1);
    });

    it("request_id que já pertence a outra loja não devolve a campanha dela", async () => {
        const c = cenario({ campanhas: [{ barracaId: B, requestId: req(1) }] });
        const r = await executarAcaoDisparo(criar(), c.deps);
        expect(r).toEqual({ ok: false, motivo: "campanha_em_andamento" });
        expect(c.envios).toHaveLength(0);
    });

    it("sessão desconectada ou loja sem vínculo: whatsapp_desconectado", async () => {
        expect(await executarAcaoDisparo(criar(), cenario({ conectadas: [] }).deps)).toEqual({ ok: false, motivo: "whatsapp_desconectado" });
        expect(await executarAcaoDisparo(criar(), cenario({ sessoes: {} }).deps)).toEqual({ ok: false, motivo: "whatsapp_desconectado" });
    });

    it("campanha em andamento bloqueia a segunda", async () => {
        const c = cenario({ campanhas: [{ estado: "em_andamento", criadoEm: new Date(AGORA - H) }] });
        expect(await executarAcaoDisparo(criar(), c.deps)).toEqual({ ok: false, motivo: "campanha_em_andamento" });
    });

    it("campanha em andamento de outra loja não bloqueia", async () => {
        const c = cenario({ campanhas: [{ barracaId: B, estado: "em_andamento" }] });
        expect(await executarAcaoDisparo(criar(), c.deps)).toMatchObject({ ok: true });
    });

    it("duas campanhas em 24 h: a terceira é recusada; as de mais de 24 h não contam", async () => {
        const duas = cenario({ campanhas: [{ criadoEm: new Date(AGORA - 3 * H) }, { criadoEm: new Date(AGORA - 5 * H), estado: "cancelada" }] });
        expect(await executarAcaoDisparo(criar(), duas.deps)).toEqual({ ok: false, motivo: "limite_campanhas_dia" });
        const antigas = cenario({ campanhas: [{ criadoEm: new Date(AGORA - 25 * H) }, { criadoEm: new Date(AGORA - 30 * H) }] });
        expect(await executarAcaoDisparo(criar(), antigas.deps)).toMatchObject({ ok: true });
    });

    it("só inválidos: sem_destinatarios_validos", async () => {
        const c = cenario();
        expect(await executarAcaoDisparo(criar({ destinatarios: [{ telefone: "123456789", nome: null }] }), c.deps)).toEqual({ ok: false, motivo: "sem_destinatarios_validos" });
        expect(c.campanhas).toHaveLength(0);
    });
});

describe("histórico", () => {
    it("conta enviados, falhas, pulados e fila por campanha, só da loja pedida", async () => {
        const c = cenario({
            campanhas: [{ id: "c0", total: 6 }, { id: "c1", barracaId: B }],
            envios: [
                { campanhaId: "c0", estado: "enviado" }, { campanhaId: "c0", estado: "enviado" }, { campanhaId: "c0", estado: "falhou" },
                { campanhaId: "c0", estado: "pulado_optout" }, { campanhaId: "c0", estado: "pulado_limite_diario" }, { campanhaId: "c0", estado: "pendente" },
                { campanhaId: "c1", barracaId: B, estado: "enviado" },
            ],
            avaliacoes: [
                { pedidoId: "p1", nota: 5, comentario: "ótimo", respondidaEm: new Date(AGORA), enviadaEm: new Date(AGORA - H) },
                { pedidoId: "p2", nota: 2, respondidaEm: new Date(AGORA), enviadaEm: new Date(AGORA - H) },
                { pedidoId: "p3", nota: null, enviadaEm: new Date(AGORA - H) },
                { pedidoId: "p4", barracaId: B, nota: 1, respondidaEm: new Date(AGORA), enviadaEm: new Date(AGORA) },
            ],
        });
        const r = (await executarAcaoDisparo({ barraca_id: A, request_id: req(2), acao: "historico" }, c.deps)) as Extract<Awaited<ReturnType<typeof executarAcaoDisparo>>, { campanhas: unknown }>;
        expect(r.campanhas).toHaveLength(1);
        expect(r.campanhas[0]).toMatchObject({ id: "c0", enviados: 2, falhas: 1, pulados: 2, na_fila: 1, total: 6 });
        expect(r.avaliacoes).toMatchObject({ media: 3.5, total: 2, enviadas_30d: 3 });
        expect(r.avaliacoes.itens.map((i) => i.pedido_id).sort()).toEqual(["p1", "p2"]);
    });

    it("campanha esquecida em andamento por mais de 24 h aparece como expirada", async () => {
        const c = cenario({ campanhas: [{ estado: "em_andamento", criadoEm: new Date(AGORA - 26 * H) }] });
        const r = (await executarAcaoDisparo({ barraca_id: A, request_id: req(2), acao: "historico" }, c.deps)) as { campanhas: { estado: string }[] };
        expect(r.campanhas[0].estado).toBe("expirada");
    });

    it("sem campanhas nem avaliações: listas vazias e média nula", async () => {
        const r = await executarAcaoDisparo({ barraca_id: A, request_id: req(2), acao: "historico" }, cenario().deps);
        expect(r).toEqual({ ok: true, campanhas: [], avaliacoes: { media: null, total: 0, enviadas_30d: 0, itens: [] } });
    });
});

describe("cancelar", () => {
    it("cancela só os pendentes da campanha da loja e limpa o payload", async () => {
        const c = cenario({
            campanhas: [{ id: "c0", estado: "em_andamento" }],
            envios: [{ campanhaId: "c0", estado: "pendente" }, { campanhaId: "c0", estado: "pendente" }, { campanhaId: "c0", estado: "enviado" }],
        });
        const r = await executarAcaoDisparo({ barraca_id: A, request_id: req(3), acao: "cancelar", campanha_id: "c0" }, c.deps);
        expect(r).toEqual({ ok: true, cancelados: 2 });
        expect(c.envios.map((e) => e.estado)).toEqual(["cancelado", "cancelado", "enviado"]);
        expect(c.envios[0].payload).toBe(Prisma.DbNull);
        expect(c.campanhas[0].estado).toBe("cancelada");
    });

    it("campanha de outra loja: nada cancelado", async () => {
        const c = cenario({ campanhas: [{ id: "c0", barracaId: A, estado: "em_andamento" }], envios: [{ campanhaId: "c0", barracaId: A, estado: "pendente" }] });
        const r = await executarAcaoDisparo({ barraca_id: B, request_id: req(3), acao: "cancelar", campanha_id: "c0" }, c.deps);
        expect(r).toEqual({ ok: true, cancelados: 0 });
        expect(c.envios[0].estado).toBe("pendente");
        expect(c.campanhas[0].estado).toBe("em_andamento");
    });
});

describe("validarPedidoDisparo", () => {
    const base = { barraca_id: A, request_id: req(1) };
    it("aceita os três formatos do contrato", () => {
        expect(validarPedidoDisparo(criar()).ok).toBe(true);
        expect(validarPedidoDisparo({ ...base, acao: "historico" }).ok).toBe(true);
        expect(validarPedidoDisparo({ ...base, acao: "cancelar", campanha_id: "abc" }).ok).toBe(true);
    });
    it("recusa campo extra, lista vazia, 501 itens, telefone fora de 8-15 dígitos e texto em branco", () => {
        expect(validarPedidoDisparo({ ...criar(), extra: 1 }).ok).toBe(false);
        expect(validarPedidoDisparo(criar({ destinatarios: [] })).ok).toBe(false);
        expect(validarPedidoDisparo(criar({ destinatarios: Array.from({ length: 501 }, () => ({ telefone: "61999990001", nome: null })) })).ok).toBe(false);
        expect(validarPedidoDisparo(criar({ destinatarios: [{ telefone: "1234567", nome: null }] })).ok).toBe(false);
        expect(validarPedidoDisparo(criar({ destinatarios: [{ telefone: "61999990001", nome: null, x: 1 }] })).ok).toBe(false);
        expect(validarPedidoDisparo(criar({ texto: "   " })).ok).toBe(false);
        expect(validarPedidoDisparo(criar({ texto: "a".repeat(601) })).ok).toBe(false);
        expect(validarPedidoDisparo(criar({ tipo: "outro" })).ok).toBe(false);
        expect(validarPedidoDisparo({ ...base, acao: "cancelar", campanha_id: "" }).ok).toBe(false);
    });
});
