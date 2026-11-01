import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
    barraca: null as { id: string } | null,
    upsert: vi.fn(async () => ({})),
}));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        session: { findUnique: vi.fn(async () => ({ id: "db-1" })) },
        barracaSessao: { findUnique: vi.fn(async () => db.barraca) },
        agenteConfig: {
            findUnique: vi.fn(async () => ({ grupoRecepcaoJid: "120363000000000000@g.us", emailAviso: null, linkAgendamento: "https://x.com/agenda" })),
            upsert: db.upsert,
        },
    },
}));
vi.mock("@/lib/admin-auth", () => ({ exigirSuperadmin: vi.fn(async () => null) }));
vi.mock("@/lib/api-auth", () => ({
    getAuthenticatedUser: vi.fn(async () => ({ id: "u1", role: "SUPERADMIN" })),
    canAccessSession: vi.fn(async () => true),
}));

import { PUT } from "./route";

const chamar = (corpo: unknown) =>
    PUT({ json: async () => corpo } as never, { params: Promise.resolve({ sessionId: "s1" }) });

beforeEach(() => {
    db.barraca = null;
    db.upsert.mockClear();
});

describe("PUT /api/agente/[sessionId]/config — trava de barraca", () => {
    it("ativo=true em sessão de barraca responde 409 em PT-BR e não grava", async () => {
        db.barraca = { id: "b1" };
        const r = await chamar({ ativo: true });
        expect(r.status).toBe(409);
        expect((await r.json()).message).toBe("Este número está ligado a um restaurante do Sai aê; o atendente de IA não pode ser ativado nele.");
        expect(db.upsert).not.toHaveBeenCalled();
    });
    it("ativo=true em sessão sem barraca continua funcionando", async () => {
        const r = await chamar({ ativo: true });
        expect(r.status).toBe(200);
        expect(db.upsert).toHaveBeenCalled();
    });
    it("desligar (ativo=false) numa sessão de barraca continua permitido", async () => {
        db.barraca = { id: "b1" };
        const r = await chamar({ ativo: false });
        expect(r.status).toBe(200);
    });
});
