import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WAMessage } from "@whiskeysockets/baileys";

const createMany = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { conversaOrigem: { createMany: (...a: unknown[]) => createMany(...a) } } }));

import { ehPrimeiraRecebida, origemDaMensagem, registrarOrigemConversa } from "./anuncio";

const msg = (message: object) => ({ key: { remoteJid: "5511999999999@s.whatsapp.net", id: "K1" }, message }) as unknown as WAMessage;
const aguardar = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    createMany.mockReset().mockResolvedValue({ count: 1 });
});

describe("origemDaMensagem", () => {
    it("externalAdReply no contextInfo é anúncio", () => {
        expect(origemDaMensagem(msg({ extendedTextMessage: { text: "oi", contextInfo: { externalAdReply: { title: "Promo" } } } }))).toBe("anuncio");
    });
    it("conversionSource no contextInfo é anúncio", () => {
        expect(origemDaMensagem(msg({ extendedTextMessage: { text: "oi", contextInfo: { conversionSource: "ctwa_ad" } } }))).toBe("anuncio");
    });
    it("texto simples é orgânico", () => {
        expect(origemDaMensagem(msg({ conversation: "oi" }))).toBe("organico");
    });
});

describe("registrarOrigemConversa", () => {
    it("repassa skipDuplicates ao banco em cada chamada (a unicidade real é do índice)", async () => {
        registrarOrigemConversa("s1", "5511@s.whatsapp.net", "anuncio");
        registrarOrigemConversa("s1", "5511@s.whatsapp.net", "organico");
        await aguardar();
        expect(createMany).toHaveBeenCalledTimes(2);
        expect(createMany).toHaveBeenNthCalledWith(1, { data: [{ sessionId: "s1", jid: "5511@s.whatsapp.net", origem: "anuncio" }], skipDuplicates: true });
    });
    it("falha do banco não lança erro", async () => {
        createMany.mockRejectedValue(new Error("db fora"));
        expect(() => registrarOrigemConversa("s1", "j", "organico")).not.toThrow();
        await aguardar();
    });
});

describe("ehPrimeiraRecebida", () => {
    const agora = Date.now();
    const base = { fromMe: false, triggerWebhook: true, timestamp: new Date(agora - 5_000), agora, recebidas: 1 };
    it("primeira mensagem ao vivo (mesmo sendo resposta a algo) conta", () => {
        expect(ehPrimeiraRecebida(base)).toBe(true);
    });
    it("fromMe, histórico (triggerWebhook=false) e timestamp antigo não contam", () => {
        expect(ehPrimeiraRecebida({ ...base, fromMe: true })).toBe(false);
        expect(ehPrimeiraRecebida({ ...base, triggerWebhook: false })).toBe(false);
        expect(ehPrimeiraRecebida({ ...base, timestamp: new Date(agora - 11 * 60_000) })).toBe(false);
    });
    it("segunda mensagem recebida não conta", () => {
        expect(ehPrimeiraRecebida({ ...base, recebidas: 2 })).toBe(false);
    });
});
