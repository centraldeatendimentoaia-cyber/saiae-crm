import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- banco em memória: sugestões, rascunho e versões. $transaction desfaz tudo se o callback lançar.
const db = vi.hoisted(() => {
    type Sug = { id: string; sessionId: string; cliente: string; resposta: string; status: string; criadoEm: Date };
    const estado = {
        sugestoes: [] as Sug[],
        rascunhos: new Map<string, unknown>(),
        publicado: null as unknown,
        mensagem: null as { content: string } | null,
        treinoPublicado: null as unknown,
        erroBanco: false,
        seq: 0,
    };
    const casa = (s: Sug, w: Record<string, unknown>) => Object.entries(w).every(([k, v]) => (s as Record<string, unknown>)[k] === v);
    const prisma = {
        atendenteSugestao: {
            create: vi.fn(async ({ data }: { data: Omit<Sug, "id" | "status" | "criadoEm"> }) => {
                if (estado.erroBanco) throw new Error("banco fora");
                const s = { id: `g${++estado.seq}`, status: "pendente", criadoEm: new Date(), ...data };
                estado.sugestoes.push(s);
                return s;
            }),
            count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
                if (estado.erroBanco) throw new Error("banco fora");
                return estado.sugestoes.filter((s) => casa(s, where)).length;
            }),
            findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
                if (estado.erroBanco) throw new Error("banco fora");
                return estado.sugestoes.find((s) => casa(s, where)) ?? null;
            }),
            updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Sug> }) => {
                const alvo = estado.sugestoes.filter((s) => casa(s, where));
                alvo.forEach((s) => Object.assign(s, data));
                return { count: alvo.length };
            }),
        },
        atendenteTreino: {
            findUnique: vi.fn(async ({ where }: { where: { sessionId: string } }) =>
                estado.rascunhos.has(where.sessionId) ? { sessionId: where.sessionId, rascunho: estado.rascunhos.get(where.sessionId), publicadoVersao: 1 } : null),
            upsert: vi.fn(async ({ where, create }: { where: { sessionId: string }; create: { rascunho: unknown } }) => {
                estado.rascunhos.set(where.sessionId, create.rascunho);
                return {};
            }),
        },
        atendenteVersao: { create: vi.fn(() => { throw new Error("não pode criar versão"); }) },
        session: { findUnique: vi.fn(async () => ({ id: "db-1" })) },
        message: { findFirst: vi.fn(async () => estado.mensagem) },
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
            const antes = { sug: estado.sugestoes.map((s) => ({ ...s })), ras: new Map(estado.rascunhos) };
            try {
                return await fn(prisma);
            } catch (e) {
                estado.sugestoes = antes.sug;
                estado.rascunhos = antes.ras;
                throw e;
            }
        }),
    };
    return { estado, prisma };
});
vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));
vi.mock("@/modules/atendente/integracao", () => ({ usarAtendenteNovo: vi.fn(async () => db.estado.treinoPublicado) }));

import { MODELOS } from "./modelos-prontos";
import { LIMITE_EXEMPLOS, TreinoSchema, type Treino } from "./treino";
import { aprovarSugestao, criarSugestao, descartarSugestao, mascararDados, MAX_PENDENTES, registrarCorrecaoHumana } from "./sugestoes";

const RESP = "Temos horário amanhã às 10h, quer que eu reserve?";
const copia = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const rascunho = () => TreinoSchema.parse(db.estado.rascunhos.get("s1")) as Treino;

beforeEach(() => {
    db.estado.sugestoes = [];
    db.estado.rascunhos = new Map([["s1", copia(MODELOS.salao)]]);
    db.estado.mensagem = null;
    db.estado.treinoPublicado = null;
    db.estado.erroBanco = false;
    db.estado.seq = 0;
});

describe("mascararDados", () => {
    it("troca telefone, e-mail e JID por marcadores", () => {
        expect(mascararDados("me liga no (11) 98765-4321 ou +55 11 98765 4321")).toBe("me liga no [telefone] ou [telefone]");
        expect(mascararDados("manda para ana.souza+x@gmail.com")).toBe("manda para [e-mail]");
        expect(mascararDados("contato 5511987654321@s.whatsapp.net e 123456789@lid")).toBe("contato [contato] e [contato]");
    });
    it("não mexe em preços, horários e números curtos", () => {
        const t = "Custa R$ 150,00, das 9h às 18h, 3 sessões";
        expect(mascararDados(t)).toBe(t);
    });
});

describe("criarSugestao", () => {
    it("resposta curta (menos de 15 caracteres) não vira sugestão", async () => {
        await criarSugestao("s1", "tem horário?", "Tem sim, 10h");
        expect(db.estado.sugestoes).toHaveLength(0);
    });
    it("telefone e e-mail nunca são gravados", async () => {
        await criarSugestao("s1", "meu número é 11 98765-4321", `${RESP} Me chama no 11987654321 ou ana@x.com.br`);
        expect(db.estado.sugestoes).toHaveLength(1);
        const s = db.estado.sugestoes[0];
        expect(`${s.cliente} ${s.resposta}`).not.toMatch(/\d{4}|@/);
        expect(s.resposta).toContain("[telefone]");
        expect(s.resposta).toContain("[e-mail]");
    });
    it("corta textos longos e grava pendente", async () => {
        await criarSugestao("s1", "a".repeat(5000), "b".repeat(5000));
        const s = db.estado.sugestoes[0];
        expect(s.cliente.length).toBe(1000);
        expect(s.resposta.length).toBe(2000);
        expect(s.resposta.endsWith("…")).toBe(true);
        expect(s.status).toBe("pendente");
    });
    it("não duplica sugestão pendente idêntica e respeita o teto por sessão", async () => {
        await criarSugestao("s1", "tem horário?", RESP);
        await criarSugestao("s1", "tem horário?", RESP);
        expect(db.estado.sugestoes).toHaveLength(1);
        for (let i = 1; i < MAX_PENDENTES + 5; i++) await criarSugestao("s1", `pergunta ${i}`, RESP);
        expect(db.estado.sugestoes).toHaveLength(MAX_PENDENTES);
    });
    it("nunca lança, nem com o banco fora", async () => {
        db.estado.erroBanco = true;
        await expect(criarSugestao("s1", "tem horário?", RESP)).resolves.toBeUndefined();
    });
});

describe("aprovarSugestao", () => {
    const criar = async () => {
        await criarSugestao("s1", "tem horário amanhã?", RESP);
        return db.estado.sugestoes[0].id;
    };
    it("como exemplo: altera só o rascunho, não cria versão publicada", async () => {
        const id = await criar();
        const antes = rascunho().exemplos.length;
        await aprovarSugestao("s1", id, "exemplo");
        expect(rascunho().exemplos).toHaveLength(antes + 1);
        expect(rascunho().exemplos.at(-1)).toEqual({ cliente: "tem horário amanhã?", ideal: RESP });
        expect(db.prisma.atendenteVersao.create).not.toHaveBeenCalled();
        expect(db.estado.sugestoes[0].status).toBe("aprovada");
    });
    it("como base: entra como 'Correção da equipe'", async () => {
        const id = await criar();
        await aprovarSugestao("s1", id, "base");
        expect(rascunho().base.at(-1)).toMatchObject({ titulo: "Correção da equipe", texto: RESP });
    });
    it("de outra sessão ou já tratada: erro com status", async () => {
        const id = await criar();
        await expect(aprovarSugestao("s2", id, "exemplo")).rejects.toMatchObject({ status: 404 });
        await descartarSugestao("s1", id);
        await expect(aprovarSugestao("s1", id, "exemplo")).rejects.toMatchObject({ status: 409 });
    });
    it("sem rascunho na sessão: erro claro e continua pendente", async () => {
        const id = await criar();
        db.estado.rascunhos.clear();
        await expect(aprovarSugestao("s1", id, "exemplo")).rejects.toMatchObject({ status: 409 });
        expect(db.estado.sugestoes[0].status).toBe("pendente");
    });
    it("limite de exemplos: erro em PT-BR, rascunho intacto e sugestão pendente", async () => {
        const t = copia(MODELOS.salao) as Treino;
        t.exemplos = Array.from({ length: LIMITE_EXEMPLOS }, (_, i) => ({ cliente: `c${i}`, ideal: `i${i}` }));
        db.estado.rascunhos.set("s1", t);
        const id = await criar();
        await expect(aprovarSugestao("s1", id, "exemplo")).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/máximo/) });
        expect(rascunho().exemplos).toHaveLength(LIMITE_EXEMPLOS);
        expect(db.estado.sugestoes[0].status).toBe("pendente");
    });
});

describe("descartarSugestao", () => {
    it("marca descartada; outra sessão dá 404", async () => {
        await criarSugestao("s1", "tem horário amanhã?", RESP);
        const id = db.estado.sugestoes[0].id;
        await expect(descartarSugestao("s2", id)).rejects.toMatchObject({ status: 404 });
        await descartarSugestao("s1", id);
        expect(db.estado.sugestoes[0].status).toBe("descartada");
    });
});

describe("registrarCorrecaoHumana (chamada pelo agente)", () => {
    it("sem treino publicado não faz nada (sessão legada fica igual)", async () => {
        db.estado.mensagem = { content: "tem horário amanhã?" };
        await registrarCorrecaoHumana("s1", "5511@s.whatsapp.net", RESP, new Date());
        expect(db.prisma.message.findFirst).not.toHaveBeenCalled();
        expect(db.estado.sugestoes).toHaveLength(0);
    });
    it("com treino publicado só cria sugestão pendente: nunca mexe no rascunho nem publica", async () => {
        db.estado.treinoPublicado = MODELOS.salao;
        db.estado.mensagem = { content: "tem horário amanhã?" };
        const antes = JSON.stringify(db.estado.rascunhos.get("s1"));
        await registrarCorrecaoHumana("s1", "5511@s.whatsapp.net", RESP, new Date());
        expect(db.estado.sugestoes).toMatchObject([{ cliente: "tem horário amanhã?", resposta: RESP, status: "pendente" }]);
        expect(JSON.stringify(db.estado.rascunhos.get("s1"))).toBe(antes);
        expect(db.prisma.atendenteTreino.upsert).not.toHaveBeenCalled();
        expect(db.prisma.atendenteVersao.create).not.toHaveBeenCalled();
    });
    it("sem mensagem do cliente na janela: nada; erro do banco: não lança", async () => {
        db.estado.treinoPublicado = MODELOS.salao;
        await registrarCorrecaoHumana("s1", "5511@s.whatsapp.net", RESP, new Date());
        expect(db.estado.sugestoes).toHaveLength(0);
        db.prisma.message.findFirst.mockRejectedValueOnce(new Error("banco fora"));
        await expect(registrarCorrecaoHumana("s1", "5511@s.whatsapp.net", RESP, new Date())).resolves.toBeUndefined();
    });
    it("o agente não importa nenhuma função de aprovação", () => {
        const fonte = readFileSync(path.resolve(__dirname, "../agente-salao/agente.ts"), "utf8");
        expect(fonte).not.toMatch(/aprovarSugestao|descartarSugestao|salvarRascunho|publicar\(/);
        expect(fonte).toMatch(/registrarCorrecaoHumana/);
    });
});
