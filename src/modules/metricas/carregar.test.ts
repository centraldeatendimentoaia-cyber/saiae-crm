import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
    origens: [] as { jid: string; origem: string }[],
    grupos: [] as { remoteJid: string; _max: { timestamp: Date | null } }[],
    contatos: [] as { jid: string; lid: string | null }[],
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        conversaOrigem: { findMany: vi.fn(async () => db.origens) },
        message: { groupBy: vi.fn(async () => db.grupos) },
        contact: { findMany: vi.fn(async () => db.contatos) },
    },
}));

import { prisma } from "@/lib/prisma";
import { carregarContextoMetricas } from "./carregar";

const inicio = new Date("2026-10-12T03:00:00Z");
const chamar = (contatos: string[]) => carregarContextoMetricas({ dbSessionId: "db-1", sessionId: "s1", contatos, inicio, ate: new Date("2026-10-18T23:59:59Z") });

beforeEach(() => {
    db.origens = [];
    db.grupos = [];
    db.contatos = [];
    vi.clearAllMocks();
});

describe("carregarContextoMetricas", () => {
    it("consulta pelo id do banco antes de inicio; só mensagens recebidas para a última", async () => {
        db.grupos = [{ remoteJid: "a@s.whatsapp.net", _max: { timestamp: new Date("2026-10-01T00:00:00Z") } }];
        const r = await chamar(["a@s.whatsapp.net"]);
        const [qualquer, recebidas] = vi.mocked(prisma.message.groupBy).mock.calls.map((c) => (c[0] as { where: Record<string, unknown> }).where);
        expect(qualquer).toEqual({ sessionId: "db-1", remoteJid: { in: ["a@s.whatsapp.net"] }, timestamp: { lt: inicio } });
        expect(recebidas).toEqual({ ...qualquer, fromMe: false });
        expect(r.ultimaMensagemAntes.get("a@s.whatsapp.net")).toEqual(new Date("2026-10-01T00:00:00Z"));
        expect([...r.primeiraMensagemAntes]).toEqual(["a@s.whatsapp.net"]);
    });
    it("sem Message, Contact.createdAt anterior a inicio marca como já conhecido, sem data de reativação", async () => {
        db.contatos = [{ jid: "a@s.whatsapp.net", lid: "a@lid" }];
        const r = await chamar(["a@lid", "novo@s.whatsapp.net"]);
        expect(vi.mocked(prisma.contact.findMany).mock.calls[0][0]).toMatchObject({ where: { sessionId: "db-1", createdAt: { lt: inicio } } });
        expect(r.primeiraMensagemAntes.has("a@lid")).toBe(true);
        expect(r.primeiraMensagemAntes.has("novo@s.whatsapp.net")).toBe(false);
        expect(r.ultimaMensagemAntes.size).toBe(0);
    });
    it("lê as origens em lotes com a string do Baileys e normaliza o valor", async () => {
        db.origens = [{ jid: "a@s.whatsapp.net", origem: "anuncio" }, { jid: "b@s.whatsapp.net", origem: "organico" }];
        const jids = Array.from({ length: 2500 }, (_, i) => `${i}@s.whatsapp.net`);
        const r = await chamar(jids);
        expect(prisma.conversaOrigem.findMany).toHaveBeenCalledTimes(3);
        expect(vi.mocked(prisma.conversaOrigem.findMany).mock.calls[0][0]).toMatchObject({ where: { sessionId: "s1" } });
        expect(r.origensConversa.get("a@s.whatsapp.net")).toBe("anuncio");
        expect(r.origensConversa.get("b@s.whatsapp.net")).toBe("organico");
    });
});
