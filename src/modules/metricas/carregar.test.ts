import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
    origens: [] as { jid: string; origem: string }[],
    grupos: [] as { remoteJid: string; _max: { timestamp: Date | null } }[],
    contatos: [] as { jid: string; lid: string | null; lastInboundAt: Date | null }[],
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
    it("usa Contact.lastInboundAt quando a retenção apagou as mensagens antigas", async () => {
        db.contatos = [{ jid: "a@s.whatsapp.net", lid: "a@lid", lastInboundAt: new Date("2026-08-01T00:00:00Z") }];
        const r = await chamar(["a@lid"]);
        expect(r.ultimaMensagemAntes.get("a@lid")).toEqual(new Date("2026-08-01T00:00:00Z"));
        expect(r.primeiraMensagemAntes.has("a@lid")).toBe(true);
    });
    it("contato com Message e Contact fica com a data mais recente e uma só entrada", async () => {
        db.grupos = [{ remoteJid: "a@s.whatsapp.net", _max: { timestamp: new Date("2026-10-01T00:00:00Z") } }];
        db.contatos = [{ jid: "a@s.whatsapp.net", lid: null, lastInboundAt: new Date("2026-08-01T00:00:00Z") }];
        const r = await chamar(["a@s.whatsapp.net", "novo@s.whatsapp.net"]);
        expect(r.ultimaMensagemAntes.size).toBe(1);
        expect(r.ultimaMensagemAntes.get("a@s.whatsapp.net")).toEqual(new Date("2026-10-01T00:00:00Z"));
        expect([...r.primeiraMensagemAntes]).toEqual(["a@s.whatsapp.net"]);
        expect(r.primeiraMensagemAntes.has("novo@s.whatsapp.net")).toBe(false);
    });
    it("lê as origens em lotes e normaliza o valor", async () => {
        db.origens = [{ jid: "a@s.whatsapp.net", origem: "anuncio" }, { jid: "b@s.whatsapp.net", origem: "organico" }];
        const jids = Array.from({ length: 2500 }, (_, i) => `${i}@s.whatsapp.net`);
        const r = await chamar(jids);
        expect(prisma.conversaOrigem.findMany).toHaveBeenCalledTimes(3);
        expect(r.origensConversa.get("a@s.whatsapp.net")).toBe("anuncio");
        expect(r.origensConversa.get("b@s.whatsapp.net")).toBe("organico");
    });
});
