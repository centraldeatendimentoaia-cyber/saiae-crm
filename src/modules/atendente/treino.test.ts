import { beforeEach, describe, expect, it, vi } from "vitest";

type Treino = import("./treino").Treino;

// Banco falso em memória: cobre só o que armazenamento.ts usa. vi.hoisted porque vi.mock sobe para antes dos imports.
const { est, db, logWarn } = vi.hoisted(() => {
    const est = {
        treinos: new Map<string, { sessionId: string; rascunho: unknown; publicadoVersao: number | null }>(),
        versoes: [] as { sessionId: string; versao: number; conteudo: unknown }[],
        falhasUnicas: 0, // quantas criações de versão devem falhar com P2002 (corrida simulada)
    };
    const db = {
        atendenteTreino: {
            findUnique: async ({ where }: { where: { sessionId: string } }) => est.treinos.get(where.sessionId) ?? null,
            upsert: async ({ where, create, update }: { where: { sessionId: string }; create: { sessionId: string; rascunho: unknown; publicadoVersao?: number }; update: { rascunho: unknown; publicadoVersao?: number } }) => {
                const atual = est.treinos.get(where.sessionId);
                est.treinos.set(where.sessionId, atual ? { ...atual, ...update } : { publicadoVersao: null, ...create });
            },
            update: async ({ where, data }: { where: { sessionId: string }; data: { rascunho?: unknown; publicadoVersao?: number } }) => {
                est.treinos.set(where.sessionId, { ...est.treinos.get(where.sessionId)!, ...data });
            },
        },
        atendenteVersao: {
            aggregate: async ({ where }: { where: { sessionId: string } }) => {
                const max = Math.max(0, ...est.versoes.filter((v) => v.sessionId === where.sessionId).map((v) => v.versao));
                return { _max: { versao: max || null } };
            },
            findUnique: async ({ where }: { where: { sessionId_versao: { sessionId: string; versao: number } } }) =>
                est.versoes.find((v) => v.sessionId === where.sessionId_versao.sessionId && v.versao === where.sessionId_versao.versao) ?? null,
            create: async ({ data }: { data: { sessionId: string; versao: number; conteudo: unknown } }) => {
                if (est.falhasUnicas > 0) {
                    est.falhasUnicas--;
                    throw Object.assign(new Error("unique"), { code: "P2002" });
                }
                est.versoes.push(data);
            },
        },
    };
    return { est, db, logWarn: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: { ...db, $transaction: async (fn: (t: typeof db) => unknown) => fn(db) } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: (...a: unknown[]) => logWarn(...a), error: vi.fn(), info: vi.fn() } }));

import { carregarPublicado, publicar, reverter, salvarRascunho } from "./armazenamento";
import { MODELOS } from "./modelos-prontos";
import { TreinoSchema } from "./treino";

const base = (): Treino => structuredClone(MODELOS.branco);
const comMudanca = (nome: string): Treino => ({ ...base(), identidade: { ...base().identidade, nome } });

beforeEach(() => {
    est.treinos.clear();
    est.versoes = [];
    est.falhasUnicas = 0;
    logWarn.mockReset();
});

describe("TreinoSchema", () => {
    it("rejeita link sem https://", () => {
        const t = base();
        t.roteiro.desfecho = { tipo: "link", link: "http://exemplo.com" };
        expect(TreinoSchema.safeParse(t).success).toBe(false);
        t.roteiro.desfecho = { tipo: "link", link: "javascript:alert(1)" };
        expect(TreinoSchema.safeParse(t).success).toBe(false);
    });
    it("aceita link https e exige o link quando o desfecho é link", () => {
        const t = base();
        t.roteiro.desfecho = { tipo: "link", link: "https://exemplo.com/agendar" };
        expect(TreinoSchema.safeParse(t).success).toBe(true);
        t.roteiro.desfecho = { tipo: "link" };
        expect(TreinoSchema.safeParse(t).success).toBe(false);
    });
    it("rejeita base acima de 40 000 caracteres no total", () => {
        const t = base();
        const bloco = "a".repeat(20_000);
        t.base = [
            { titulo: "a", texto: bloco, atualizadoEm: "2026-11-01" },
            { titulo: "b", texto: bloco, atualizadoEm: "2026-11-01" },
        ];
        expect(TreinoSchema.safeParse(t).success).toBe(true);
        t.base.push({ titulo: "c", texto: "x", atualizadoEm: "2026-11-01" });
        expect(TreinoSchema.safeParse(t).success).toBe(false);
    });
    it("rejeita mais de 30 objeções e mais de 30 exemplos", () => {
        const t = base();
        const o = { cliente: "c", resposta: "r", proximoPasso: "p" };
        t.objecoes = Array(30).fill(o);
        expect(TreinoSchema.safeParse(t).success).toBe(true);
        t.objecoes = Array(31).fill(o);
        expect(TreinoSchema.safeParse(t).success).toBe(false);
        t.objecoes = [];
        t.exemplos = Array(31).fill({ cliente: "c", ideal: "i" });
        expect(TreinoSchema.safeParse(t).success).toBe(false);
    });
    it("aceita até 18 gatilhos (6 padrão + 12 extras) e rejeita 19", () => {
        const t = base();
        const g = (i: number) => ({ id: `g${i}`, ativo: true, descricao: "d", frase: "f" });
        t.gatilhos = Array.from({ length: 18 }, (_, i) => g(i));
        expect(TreinoSchema.safeParse(t).success).toBe(true);
        t.gatilhos.push(g(99));
        expect(TreinoSchema.safeParse(t).success).toBe(false);
    });
    it("rejeita caractere de controle (exceto quebra de linha e tab) e apara espaços", () => {
        const t = base();
        t.identidade.tom = "oi\u0007";
        expect(TreinoSchema.safeParse(t).success).toBe(false);
        t.identidade.tom = "  linha1\n\tlinha2  ";
        const r = TreinoSchema.safeParse(t);
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.identidade.tom).toBe("linha1\n\tlinha2");
    });
});

describe("MODELOS", () => {
    it("todos passam no schema", () => {
        for (const [nome, m] of Object.entries(MODELOS)) {
            const r = TreinoSchema.safeParse(m);
            expect(r.success, `${nome}: ${r.success ? "" : r.error.message}`).toBe(true);
        }
    });
    it("só o salao contém salão/Lavínia/recepção (com ou sem acento)", () => {
        const proibidas = /sal[aã]o|lav[ií]nia|recep[cç][aã]o/i;
        for (const [nome, m] of Object.entries(MODELOS)) {
            if (nome === "salao") continue;
            expect(proibidas.test(JSON.stringify(m).normalize("NFC")), nome).toBe(false);
        }
        expect(proibidas.test(JSON.stringify(MODELOS.salao))).toBe(true);
    });
    it("modelos não-branco trazem gatilhos padrão e objeções com próximo passo", () => {
        for (const nome of ["salao", "clinica", "agencia"] as const) {
            expect(MODELOS[nome].gatilhos.length).toBeGreaterThanOrEqual(6);
            expect(MODELOS[nome].objecoes.length).toBeGreaterThanOrEqual(5);
            expect(MODELOS[nome].objecoes.every((o) => o.proximoPasso.length > 0)).toBe(true);
        }
    });
});

describe("armazenamento", () => {
    it("salvarRascunho valida antes de gravar", async () => {
        const ruim = base();
        ruim.roteiro.desfecho = { tipo: "link", link: "http://x.com" };
        await expect(salvarRascunho("s1", ruim)).rejects.toThrow();
        expect(est.treinos.size).toBe(0);
    });
    it("publicar duas vezes gera versões 1 e 2 e reverter(1) devolve o conteúdo da 1", async () => {
        await salvarRascunho("s1", comMudanca("Ana"));
        expect(await publicar("s1")).toBe(1);
        await salvarRascunho("s1", comMudanca("Bia"));
        expect(await publicar("s1")).toBe(2);
        expect((await carregarPublicado("s1"))?.identidade.nome).toBe("Bia");

        await reverter("s1", 1);
        expect((await carregarPublicado("s1"))?.identidade.nome).toBe("Ana");
        expect((est.treinos.get("s1")!.rascunho as Treino).identidade.nome).toBe("Ana");
        expect(est.treinos.get("s1")!.publicadoVersao).toBe(1);
        expect(est.versoes).toHaveLength(2); // reverter não cria versão nova
    });
    it("reverter para versão inexistente dá erro claro", async () => {
        await salvarRascunho("s1", base());
        await expect(reverter("s1", 7)).rejects.toThrow(/versão 7/);
    });
    it("carregarPublicado: null sem publicação; null e log se o JSON gravado for inválido", async () => {
        expect(await carregarPublicado("s9")).toBeNull();
        est.treinos.set("s2", { sessionId: "s2", rascunho: {}, publicadoVersao: 1 });
        est.versoes.push({ sessionId: "s2", versao: 1, conteudo: { lixo: true } });
        expect(await carregarPublicado("s2")).toBeNull();
        expect(logWarn).toHaveBeenCalled();
    });
    it("publicar tenta de novo uma vez se a versão colidir (P2002)", async () => {
        await salvarRascunho("s1", base());
        est.falhasUnicas = 1;
        expect(await publicar("s1")).toBe(1);
        est.falhasUnicas = 2;
        await expect(publicar("s1")).rejects.toThrow();
    });
    it("publicar sem rascunho dá erro claro", async () => {
        await expect(publicar("nada")).rejects.toThrow(/rascunho/);
    });
});
