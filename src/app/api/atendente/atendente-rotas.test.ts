import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
    const proibido = (nome: string) => vi.fn(() => { throw new Error(`${nome} não pode ser chamado`); });
    return {
        role: "SUPERADMIN" as string | null,
        canAccess: true,
        rascunho: null as unknown,
        versoes: [] as { versao: number }[],
        mensagens: [] as { fromMe: boolean; content: string }[],
        sendMessage: proibido("sock.sendMessage"),
        msgCreate: proibido("message.create"),
        msgUpsert: proibido("message.upsert"),
        msgUpdate: proibido("message.update"),
        vendaCreate: proibido("vendaIA.create"),
        contactWrite: proibido("contact.upsert"),
        chamadasLlm: 0,
        salvar: vi.fn(async () => {}),
        publicar: vi.fn(async () => 3),
        reverter: vi.fn(async () => {}),
        limpar: vi.fn(),
    };
});

vi.mock("@/lib/api-auth", () => ({
    getAuthenticatedUser: async () => (h.role ? { id: "u1", role: h.role } : null),
    canAccessSession: async () => h.canAccess,
}));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        session: { findUnique: vi.fn(async () => ({ id: "db-1" })) },
        atendenteTreino: { findUnique: vi.fn(async () => (h.rascunho ? { sessionId: "s1", rascunho: h.rascunho, publicadoVersao: null } : null)) },
        atendenteVersao: {
            findMany: vi.fn(async () => h.versoes),
            findUnique: vi.fn(async ({ where }: { where: { sessionId_versao: { versao: number } } }) => (h.versoes.some((v) => v.versao === where.sessionId_versao.versao) ? { id: "v" } : null)),
        },
        message: { findMany: vi.fn(async () => [...h.mensagens].reverse()), create: h.msgCreate, upsert: h.msgUpsert, update: h.msgUpdate, createMany: h.msgCreate },
        vendaIA: { create: h.vendaCreate },
        contact: { upsert: h.contactWrite, update: h.contactWrite, create: h.contactWrite },
    },
}));
vi.mock("@/modules/atendente/armazenamento", () => ({ salvarRascunho: h.salvar, publicar: h.publicar, reverter: h.reverter }));
vi.mock("@/modules/atendente/integracao", () => ({ limparCacheAtendente: h.limpar }));
vi.mock("@/modules/atendente/teste", async (orig) => ({
    ...(await orig<typeof import("@/modules/atendente/teste")>()),
    obterLlm: () => ({
        responder: async () => {
            h.chamadasLlm++;
            return { texto: "Olá! Como posso ajudar?", chamadas: [] };
        },
    }),
}));

import { GET as getTreino, PUT as putTreino } from "./[sessionId]/treino/route";
import { POST as postPublicar } from "./[sessionId]/publicar/route";
import { POST as postReverter } from "./[sessionId]/reverter/route";
import { POST as postTeste } from "./[sessionId]/teste/route";
import { POST as postReproduzir } from "./[sessionId]/reproduzir/route";
import { zerarLimite } from "@/modules/atendente/teste";
import { MODELOS } from "@/modules/atendente/modelos-prontos";

const ctx = { params: Promise.resolve({ sessionId: "s1" }) };
const req = (corpo?: unknown) => ({ json: async () => corpo }) as never;
const cliente = (texto = "oi") => ({ mensagens: [{ papel: "cliente", texto }] });

beforeEach(() => {
    h.role = "SUPERADMIN";
    h.canAccess = true;
    h.rascunho = MODELOS.branco;
    h.versoes = [{ versao: 1 }, { versao: 2 }];
    h.mensagens = [];
    h.chamadasLlm = 0;
    vi.clearAllMocks();
    zerarLimite();
});

const rotas: [string, () => Promise<Response>][] = [
    ["GET treino", () => getTreino(req(), ctx)],
    ["PUT treino", () => putTreino(req(MODELOS.branco), ctx)],
    ["POST publicar", () => postPublicar(req(), ctx)],
    ["POST reverter", () => postReverter(req({ versao: 1 }), ctx)],
    ["POST teste", () => postTeste(req(cliente()), ctx)],
    ["POST reproduzir", () => postReproduzir(req({ jid: "5511999999999@s.whatsapp.net" }), ctx)],
];

describe.each(rotas)("%s: autorização", (_n, chamar) => {
    it("sem login: 401", async () => {
        h.role = null;
        expect((await chamar()).status).toBe(401);
    });
    it("sem acesso à sessão: 403", async () => {
        h.canAccess = false;
        expect((await chamar()).status).toBe(403);
    });
    it("não superadmin: 403", async () => {
        h.role = "OWNER";
        expect((await chamar()).status).toBe(403);
    });
});

describe("treino", () => {
    it("PUT com treino inválido: 400 em PT-BR e não salva", async () => {
        const r = await putTreino(req({ identidade: { nome: "", negocio: "x", tom: "" } }), ctx);
        expect(r.status).toBe(400);
        expect((await r.json()).message).toMatch(/^Treino inválido:/);
        expect(h.salvar).not.toHaveBeenCalled();
    });
    it("PUT válido salva o rascunho", async () => {
        expect((await putTreino(req(MODELOS.salao), ctx)).status).toBe(200);
        expect(h.salvar).toHaveBeenCalledTimes(1);
    });
    it("GET devolve rascunho e versões", async () => {
        const j = await (await getTreino(req(), ctx)).json();
        expect(j.data.versoes).toHaveLength(2);
        expect(j.data.rascunho).toBeTruthy();
    });
});

describe("publicar e reverter", () => {
    it("publicar sem rascunho: 409", async () => {
        h.rascunho = null;
        expect((await postPublicar(req(), ctx)).status).toBe(409);
        expect(h.publicar).not.toHaveBeenCalled();
        expect(h.limpar).not.toHaveBeenCalled();
    });
    it("publicar com rascunho limpa o cache da atendente", async () => {
        const r = await postPublicar(req(), ctx);
        expect(r.status).toBe(200);
        expect((await r.json()).data.versao).toBe(3);
        expect(h.limpar).toHaveBeenCalledWith("s1");
    });
    it("reverter versão inexistente: 404", async () => {
        expect((await postReverter(req({ versao: 9 }), ctx)).status).toBe(404);
        expect(h.reverter).not.toHaveBeenCalled();
        expect(h.limpar).not.toHaveBeenCalled();
    });
    it("reverter versão existente limpa o cache", async () => {
        expect((await postReverter(req({ versao: 1 }), ctx)).status).toBe(200);
        expect(h.reverter).toHaveBeenCalledWith("s1", 1);
        expect(h.limpar).toHaveBeenCalledWith("s1");
    });
});

describe("teste", () => {
    it("responde com o rascunho sem enviar nem gravar nada", async () => {
        const r = await postTeste(req({ mensagens: [{ papel: "cliente", texto: "oi" }, { papel: "atendente", texto: "olá" }, { papel: "cliente", texto: "quanto custa?" }] }), ctx);
        expect(r.status).toBe(200);
        const j = await r.json();
        expect(j.data.resposta.length).toBeGreaterThan(0);
        expect(h.sendMessage).not.toHaveBeenCalled();
        for (const f of [h.msgCreate, h.msgUpsert, h.msgUpdate, h.vendaCreate, h.contactWrite]) expect(f).not.toHaveBeenCalled();
    });
    it("rejeita quando a última mensagem não é do cliente", async () => {
        const r = await postTeste(req({ mensagens: [{ papel: "cliente", texto: "oi" }, { papel: "atendente", texto: "olá" }] }), ctx);
        expect(r.status).toBe(400);
        expect(h.chamadasLlm).toBe(0);
    });
    it("sem rascunho: 404", async () => {
        h.rascunho = null;
        expect((await postTeste(req(cliente()), ctx)).status).toBe(404);
    });
    it("limite de uso: a 21ª chamada no minuto dá 429", async () => {
        for (let i = 0; i < 20; i++) expect((await postTeste(req(cliente()), ctx)).status).toBe(200);
        expect((await postTeste(req(cliente()), ctx)).status).toBe(429);
    });
});

describe("reproduzir", () => {
    it("roda no máximo 14 mensagens recebidas e não envia nem grava nada", async () => {
        h.mensagens = Array.from({ length: 30 }, (_, i) => ({ fromMe: i % 5 === 4, content: `mensagem ${i}` }));
        const r = await postReproduzir(req({ jid: "5511999999999@s.whatsapp.net" }), ctx);
        expect(r.status).toBe(200);
        const j = await r.json();
        expect(j.data).toHaveLength(14);
        expect(h.chamadasLlm).toBe(14);
        expect(h.sendMessage).not.toHaveBeenCalled();
        for (const f of [h.msgCreate, h.msgUpsert, h.msgUpdate, h.vendaCreate, h.contactWrite]) expect(f).not.toHaveBeenCalled();
    });
    it("jid inválido: 400", async () => {
        expect((await postReproduzir(req({ jid: "não é jid" }), ctx)).status).toBe(400);
    });
    it("limite de uso: 429 depois de gastar o minuto", async () => {
        h.mensagens = [{ fromMe: false, content: "oi" }];
        const j = { jid: "5511999999999@s.whatsapp.net" };
        for (let i = 0; i < 4; i++) expect((await postReproduzir(req(j), ctx)).status).toBe(200);
        expect((await postReproduzir(req(j), ctx)).status).toBe(429);
    });
});
