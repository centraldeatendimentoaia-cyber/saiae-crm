import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
    acesso: true,
    usuario: { id: "u1", role: "USER" } as { id: string; role: string } | null,
    mensagens: [] as { id: string; remoteJid: string; fromMe: boolean; timestamp: Date; keyId: string; content?: string }[],
    origens: [] as { keyId: string; origem: string }[],
    cfg: null as { diasAbertos: string; horaAbre: number; horaFecha: number } | null,
    sessaoExiste: true,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        session: { findFirst: vi.fn(async () => (db.sessaoExiste ? { id: "db-1", sessionId: "s1" } : null)) },
        agenteConfig: { findUnique: vi.fn(async () => db.cfg) },
        message: {
            findMany: vi.fn(async (args: { select: Record<string, boolean> }) => db.mensagens.map((m) => Object.fromEntries(Object.keys(args.select).map((k) => [k, (m as Record<string, unknown>)[k]])))),
            groupBy: vi.fn(async () => []),
        },
        conversaOrigem: { findMany: vi.fn(async () => [{ jid: "5561999990001@s.whatsapp.net", origem: "anuncio" }]) },
        contact: { findMany: vi.fn(async () => []) },
        mensagemOrigem: {
            findFirst: vi.fn(async () => ({ criadoEm: new Date("2026-10-01T00:00:00Z") })),
            findMany: vi.fn(async () => db.origens),
        },
    },
}));
vi.mock("@/lib/api-auth", () => ({
    getAuthenticatedUser: vi.fn(async () => db.usuario),
    canAccessSession: vi.fn(async () => db.acesso),
}));

import { GET } from "./route";

const sp = (iso: string) => new Date(`${iso}-03:00`);
const chamar = (qs: string) =>
    GET({ nextUrl: new URL(`http://localhost/api/metricas/s1?${qs}`) } as never, { params: Promise.resolve({ sessionId: "s1" }) });

beforeEach(() => {
    db.acesso = true;
    db.usuario = { id: "u1", role: "USER" };
    db.cfg = null;
    db.sessaoExiste = true;
    db.origens = [{ keyId: "K2", origem: "ia" }];
    db.mensagens = [
        { id: "1", remoteJid: "5561999990001@s.whatsapp.net", fromMe: false, timestamp: sp("2026-10-12T10:00:00"), keyId: "K1", content: "segredo: meu cpf é 123" },
        { id: "2", remoteJid: "5561999990001@s.whatsapp.net", fromMe: true, timestamp: sp("2026-10-12T10:05:00"), keyId: "K2", content: "texto-sigiloso-da-resposta" },
    ];
});

describe("GET /api/metricas/[sessionId]", () => {
    it("sem login: 401; sem acesso à sessão: 403", async () => {
        db.usuario = null;
        expect((await chamar("de=2026-10-12&ate=2026-10-18")).status).toBe(401);
        db.usuario = { id: "u1", role: "USER" };
        db.acesso = false;
        expect((await chamar("de=2026-10-12&ate=2026-10-18")).status).toBe(403);
    });
    it("dono da sessão (não precisa ser superadmin) recebe o relatório", async () => {
        const r = await chamar("de=2026-10-12&ate=2026-10-18");
        expect(r.status).toBe(200);
        const { data } = await r.json();
        expect(data.demandas).toBe(1);
        expect(data.tempoPrimeiraResposta.geral.mediana).toBe(300);
        expect(data.respostasPorOrigem.ia).toBe(1);
        expect(data.demandasForaExpediente).toBe(0); // segunda 10h, expediente padrão seg-sex 9-18
    });
    it("nunca devolve conteúdo de mensagem nem telefone", async () => {
        const texto = await (await chamar("de=2026-10-12&ate=2026-10-18")).text();
        expect(texto).not.toContain("segredo");
        expect(texto).not.toContain("5561999990001");
        expect(texto).not.toContain("sigiloso");
    });
    it("usa o expediente do AgenteConfig da sessão", async () => {
        db.cfg = { diasAbertos: "2,3,4,5,6", horaAbre: 9, horaFecha: 18 }; // terça a sábado: segunda é fora
        const { data } = await (await chamar("de=2026-10-12&ate=2026-10-18")).json();
        expect(data.demandasForaExpediente).toBe(1);
    });
    it("valida as datas: 400 em PT-BR", async () => {
        const r = await chamar("de=2026-10-12");
        expect(r.status).toBe(400);
        expect((await r.json()).message).toContain("Informe o período");
        expect((await chamar("de=2026-01-01&ate=2026-12-31")).status).toBe(400);
    });
    it("formato inválido: 400", async () => {
        expect((await chamar("de=2026-10-12&ate=2026-10-18&formato=xml")).status).toBe(400);
    });
    it("sessão inexistente: 404", async () => {
        db.sessaoExiste = false;
        expect((await chamar("de=2026-10-12&ate=2026-10-18")).status).toBe(404);
    });
    it("formato=csv devolve a série diária para baixar", async () => {
        const r = await chamar("de=2026-10-12&ate=2026-10-13&formato=csv");
        expect(r.status).toBe(200);
        expect(r.headers.get("Content-Type")).toContain("text/csv");
        expect(r.headers.get("Content-Disposition")).toContain("metricas-2026-10-12-a-2026-10-13.csv");
        const corpo = await r.text();
        expect(corpo).toContain("dia;mensagens_recebidas;demandas;sem_retorno");
        expect(corpo).toContain("2026-10-12;1;1;0;300");
        expect(corpo).toContain("2026-10-13;0;0;0;");
    });

    describe("comparar=1", () => {
        const base = "de=2026-10-12&ate=2026-10-18&comparar=1";
        it("devolve atual, anterior (mesma duração, termina na véspera) e variações", async () => {
            const r = await chamar(base);
            expect(r.status).toBe(200);
            const { data } = await r.json();
            expect(data.atual.demandas).toBe(1);
            expect(data.atual.clientesDeAnuncio).toBe(1);
            expect(data.anterior.porDia).toHaveLength(7);
            expect(data.anterior.porDia[0].dia).toBe("2026-10-05");
            expect(data.anterior.porDia[6].dia).toBe("2026-10-11");
            expect(Object.keys(data.variacoes)).toEqual([
                "mensagensRecebidas", "mensagensEnviadas", "contatosUnicos", "contatosNovos", "clientesDeAnuncio", "reativados", "vendasFechadas",
                "passagensParaPessoa", "demandas", "demandasForaExpediente", "demandasSemRetorno", "demandasPendentes", "tempoMedianoPrimeiraResposta",
            ]);
        });
        it("anteriorDe/anteriorAte escolhem o período de comparação (mês anterior inteiro)", async () => {
            const r = await chamar("de=2026-10-01&ate=2026-10-12&comparar=1&anteriorDe=2026-09-01&anteriorAte=2026-09-30");
            expect(r.status).toBe(200);
            const { data } = await r.json();
            expect(data.anterior.porDia).toHaveLength(30);
            expect(data.anterior.porDia[0].dia).toBe("2026-09-01");
        });
        it("anteriorDe/anteriorAte inválidos: 400 (sem comparar, só um deles, datas ruins ou sobrepostas ao período)", async () => {
            for (const qs of [
                "de=2026-10-01&ate=2026-10-12&anteriorDe=2026-09-01&anteriorAte=2026-09-30",
                "de=2026-10-01&ate=2026-10-12&comparar=1&anteriorDe=2026-09-01",
                "de=2026-10-01&ate=2026-10-12&comparar=1&anteriorDe=x&anteriorAte=y",
                "de=2026-10-01&ate=2026-10-12&comparar=1&anteriorDe=2026-09-15&anteriorAte=2026-10-02",
            ]) expect((await chamar(qs)).status, qs).toBe(400);
        });
        it("comparar diferente de 1: 400; com formato=csv: 400", async () => {
            const r = await chamar("de=2026-10-12&ate=2026-10-18&comparar=2");
            expect(r.status).toBe(400);
            expect((await r.json()).message).toContain("comparar");
            expect((await chamar(base + "&formato=csv")).status).toBe(400);
        });
        it("401 e 403 continuam valendo", async () => {
            db.usuario = null;
            expect((await chamar(base)).status).toBe(401);
            db.usuario = { id: "u1", role: "USER" };
            db.acesso = false;
            expect((await chamar(base)).status).toBe(403);
        });
        it("a resposta não tem jid nem telefone", async () => {
            const texto = await (await chamar(base)).text();
            expect(texto).not.toContain("@s.whatsapp.net");
            expect(texto).not.toContain("@lid");
            expect(texto).not.toMatch(/\d{10,}/);
        });
    });
});
