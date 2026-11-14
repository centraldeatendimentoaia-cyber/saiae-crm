import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
    usuario: { id: "u1", role: "USER" } as { id: string; role: string } | null,
    dono: true,
    acesso: true,
    consultas: [] as { onde: string; where: Record<string, unknown> }[],
    gravados: new Map<string, Record<string, unknown>>(),
    msgs: [] as { remoteJid: string; fromMe: boolean; ts: Date }[],
}));

vi.mock("@/lib/api-auth", () => ({
    getAuthenticatedUser: vi.fn(async () => db.usuario),
    canAccessSession: vi.fn(async () => db.acesso),
    isSessionOwner: vi.fn(async () => db.dono),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/prisma", () => {
    const reg = (onde: string, retorno: unknown) => vi.fn(async (a: { where: Record<string, unknown> }) => { db.consultas.push({ onde, where: a.where }); return retorno; });
    return {
        prisma: {
            session: { findFirst: vi.fn(async () => ({ id: "db-1", sessionId: "s1", userId: "dono-1" })) },
            message: {
                groupBy: vi.fn(async (a: { where: Record<string, unknown> }) => {
                    db.consultas.push({ onde: "message", where: a.where });
                    const fromMe = a.where.fromMe as boolean;
                    return db.msgs.filter((m) => m.fromMe === fromMe).map((m) => ({ remoteJid: m.remoteJid, _min: { timestamp: m.ts } }));
                }),
            },
            vendaIA: { findMany: reg("vendaIA", []) },
            conversaOrigem: { findMany: reg("conversaOrigem", []) },
            chatLabel: { findMany: reg("chatLabel", []) },
            resultEvent: {
                findMany: reg("resultEvent", []),
                createMany: vi.fn(async ({ data }: { data: { userId: string; sessionId: string; dedupKey: string }[] }) => {
                    let n = 0;
                    for (const d of data) {
                        const k = `${d.userId}|${d.sessionId}|${d.dedupKey}`;
                        if (!db.gravados.has(k)) { db.gravados.set(k, d); n++; }
                    }
                    return { count: n };
                }),
            },
        },
    };
});

import { GET } from "./route";
import { POST } from "./importar/route";

const ctx = { params: Promise.resolve({ sessionId: "s1" }) };
const get = (qs: string) => GET(new NextRequest(`http://x/api/resultados/s1?${qs}`), ctx);
const post = (b: unknown) => POST(new NextRequest("http://x/api/resultados/s1/importar", { method: "POST", body: JSON.stringify(b) }), ctx);
const Q = "de=2026-11-01&ate=2026-11-07";

beforeEach(() => {
    db.usuario = { id: "u1", role: "USER" };
    db.dono = true;
    db.acesso = true;
    db.consultas = [];
    db.gravados.clear();
    db.msgs = [];
});

describe("GET /api/resultados", () => {
    it("401 sem login, 403 sem acesso à sessão (acesso cruzado) e nada é consultado", async () => {
        db.usuario = null;
        expect((await get(Q)).status).toBe(401);
        db.usuario = { id: "u2", role: "USER" };
        db.acesso = false;
        expect((await get(Q)).status).toBe(403);
        expect(db.consultas).toHaveLength(0);
    });
    it("painel vazio devolve zeros", async () => {
        const r = await get(Q);
        const j = await r.json();
        expect(r.status).toBe(200);
        expect(j.data.funil.linhas.every((l: { contagem: { total: number } }) => l.contagem.total === 0)).toBe(true);
    });
    it("toda consulta é escopada pela sessão e pelo dono dela", async () => {
        db.msgs = [{ remoteJid: "5561999990001@s.whatsapp.net", fromMe: false, ts: new Date("2026-11-02T12:00:00Z") }];
        await get(Q);
        for (const c of db.consultas.filter((x) => x.onde === "message")) expect(c.where.sessionId).toBe("db-1");
        expect(db.consultas.find((c) => c.onde === "vendaIA")?.where.sessionId).toBe("s1");
        const re = db.consultas.find((c) => c.onde === "resultEvent")!.where;
        expect(re).toMatchObject({ userId: "dono-1", sessionId: "s1" });
        expect(JSON.stringify(db.consultas.find((c) => c.onde === "chatLabel")!.where)).toContain('"sessionId":"s1"');
    });
    it("lead sem origem registrada aparece como origem não identificada e conta nos desconhecidos", async () => {
        db.msgs = [{ remoteJid: "5561999990001@s.whatsapp.net", fromMe: false, ts: new Date("2026-11-02T12:00:00Z") }];
        const j = await (await get(Q)).json();
        expect(j.data.funil.origemDesconhecida).toBe(1);
        expect(j.data.funil.linhas[0].porOrigem.desconhecido.confirmado).toBe(1);
    });
    it("CSV e validações de parâmetro", async () => {
        const r = await get(`${Q}&formato=csv`);
        expect(r.headers.get("content-type")).toContain("text/csv");
        expect((await get(`${Q}&origem=marte`)).status).toBe(400);
        expect((await get("de=2026-11-01")).status).toBe(400);
        expect((await get(`${Q}&formato=xml`)).status).toBe(400);
    });
});

describe("POST /api/resultados/[sessionId]/importar", () => {
    const csv = "tipo;contato;ocorrido_em;referencia\nagendamento_confirmado;5561999990001;2026-11-10;AG-1\nvenda;lixo;2026-11-10;V-1";
    it("só o dono importa (403 para quem apenas tem acesso compartilhado)", async () => {
        db.dono = false;
        expect((await post({ formato: "csv", conteudo: csv })).status).toBe(403);
        expect(db.gravados.size).toBe(0);
    });
    it("importa uma vez, rejeita lixo e não duplica na segunda vez", async () => {
        const a = await (await post({ formato: "csv", conteudo: csv })).json();
        expect(a.data).toMatchObject({ recebidas: 2, validas: 1, novos: 1, repetidos: 0, totalRejeitadas: 1 });
        const b = await (await post({ formato: "csv", conteudo: csv })).json();
        expect(b.data).toMatchObject({ novos: 0, repetidos: 1 });
        expect(db.gravados.size).toBe(1);
        // sempre gravado no userId dono da sessão, nunca no de quem fez a requisição
        expect([...db.gravados.values()][0]).toMatchObject({ userId: "dono-1", sessionId: "s1" });
    });
    it("corpo inválido e arquivo ruim dão 400", async () => {
        expect((await post({ formato: "xml", conteudo: "x" })).status).toBe(400);
        expect((await post({ formato: "csv", conteudo: "a;b\n1;2" })).status).toBe(400);
    });
});
