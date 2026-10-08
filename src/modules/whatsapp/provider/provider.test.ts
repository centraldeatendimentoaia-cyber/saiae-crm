import { describe, it, expect, vi, beforeEach } from "vitest";

const { getInstance } = vi.hoisted(() => ({ getInstance: vi.fn() }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance } }));

import { BaileysProvider, getProvider } from "./index";

function makeSocket() {
    return {
        sendMessage: vi.fn().mockResolvedValue({ key: { id: "ABC123" } }),
        onWhatsApp: vi.fn(),
    };
}

describe("BaileysProvider", () => {
    let socket: ReturnType<typeof makeSocket>;
    let provider: BaileysProvider;
    beforeEach(() => {
        socket = makeSocket();
        provider = new BaileysProvider({ sessionId: "sessao-1", socket });
    });

    it("identifica-se e declara o que suporta", () => {
        expect(provider.name).toBe("baileys");
        expect(provider.sessionId).toBe("sessao-1");
        expect(provider.capabilities).toMatchObject({ freeTextAnytime: true, templates: false, groups: true });
    });

    describe("isConnected", () => {
        it("true com socket, false sem", () => {
            expect(provider.isConnected()).toBe(true);
            expect(new BaileysProvider({ sessionId: "s", socket: null }).isConnected()).toBe(false);
        });
        it("enviar sem socket falha com erro claro, nunca em silêncio", async () => {
            const off = new BaileysProvider({ sessionId: "s", socket: null });
            await expect(off.sendText("5561999531848@s.whatsapp.net", "oi")).rejects.toThrow(/não está conectada/);
            await expect(off.resolveRecipient("5561999531848@s.whatsapp.net")).rejects.toThrow(/não está conectada/);
        });
    });

    describe("sendText", () => {
        it("chama socket.sendMessage com { text } e devolve o id", async () => {
            const r = await provider.sendText("5561999531848@s.whatsapp.net", "Olá!");
            expect(socket.sendMessage).toHaveBeenCalledTimes(1);
            expect(socket.sendMessage).toHaveBeenCalledWith("5561999531848@s.whatsapp.net", { text: "Olá!" });
            expect(r).toEqual({ messageId: "ABC123" });
        });
        it("texto vazio segue sendo enviado como antes (o agendador já fazia assim)", async () => {
            await provider.sendText("x@s.whatsapp.net", "");
            expect(socket.sendMessage).toHaveBeenCalledWith("x@s.whatsapp.net", { text: "" });
        });
        it("sem id na resposta: messageId null", async () => {
            socket.sendMessage.mockResolvedValue(undefined);
            expect(await provider.sendText("x@s.whatsapp.net", "a")).toEqual({ messageId: null });
        });
        it("erro do socket sobe para o chamador (quem decide FAILED/retry é ele)", async () => {
            socket.sendMessage.mockRejectedValue(new Error("boom"));
            await expect(provider.sendText("x@s.whatsapp.net", "a")).rejects.toThrow("boom");
        });
    });

    describe("sendMedia: payload idêntico ao que os chamadores montavam à mão", () => {
        const buf = Buffer.from("conteudo");
        const sent = () => socket.sendMessage.mock.calls[0][1];

        it("imagem com legenda", async () => {
            await provider.sendMedia("x@s.whatsapp.net", { kind: "image", data: buf, caption: "legenda" });
            expect(sent()).toStrictEqual({ image: buf, caption: "legenda" });
        });
        it("imagem sem legenda: sem chave caption", async () => {
            await provider.sendMedia("x@s.whatsapp.net", { kind: "image", data: buf });
            expect(sent()).toStrictEqual({ image: buf });
            expect("caption" in sent()).toBe(false);
        });
        it("vídeo", async () => {
            await provider.sendMedia("x@s.whatsapp.net", { kind: "video", data: buf, caption: "v" });
            expect(sent()).toStrictEqual({ video: buf, caption: "v" });
        });
        it("áudio ignora a legenda", async () => {
            await provider.sendMedia("x@s.whatsapp.net", { kind: "audio", data: buf, caption: "ignorada" });
            expect(sent()).toStrictEqual({ audio: buf });
        });
        it("documento com mimetype e nome", async () => {
            await provider.sendMedia("x@s.whatsapp.net", {
                kind: "document", data: buf, caption: "c", mimetype: "application/octet-stream", fileName: "arquivo.pdf",
            });
            expect(sent()).toStrictEqual({ document: buf, caption: "c", mimetype: "application/octet-stream", fileName: "arquivo.pdf" });
        });
        it("aceita { url } como fonte", async () => {
            await provider.sendMedia("x@s.whatsapp.net", { kind: "image", data: { url: "https://exemplo.test/a.jpg" } });
            expect(sent()).toStrictEqual({ image: { url: "https://exemplo.test/a.jpg" } });
        });
        it("devolve o id da mensagem", async () => {
            expect(await provider.sendMedia("x@s.whatsapp.net", { kind: "image", data: buf })).toEqual({ messageId: "ABC123" });
        });
    });

    describe("resolveRecipient", () => {
        it("número com WhatsApp: devolve o JID correto (9º dígito)", async () => {
            socket.onWhatsApp.mockResolvedValue([{ exists: true, jid: "556199531848@s.whatsapp.net" }]);
            expect(await provider.resolveRecipient("5561999531848@s.whatsapp.net")).toBe("556199531848@s.whatsapp.net");
            expect(socket.onWhatsApp).toHaveBeenCalledWith("5561999531848");
        });
        it("número sem WhatsApp: erro com a mesma mensagem de sempre", async () => {
            socket.onWhatsApp.mockResolvedValue([{ exists: false }]);
            await expect(provider.resolveRecipient("5561999531848@s.whatsapp.net")).rejects.toThrow("Número não possui WhatsApp");
        });
        it("grupo passa direto, sem consultar o WhatsApp", async () => {
            expect(await provider.resolveRecipient("120363123456789@g.us")).toBe("120363123456789@g.us");
            expect(socket.onWhatsApp).not.toHaveBeenCalled();
        });
    });
});

describe("getProvider", () => {
    beforeEach(() => getInstance.mockReset());

    it("sessão fora do ar: null", () => {
        getInstance.mockReturnValue(undefined);
        expect(getProvider("x")).toBeNull();
    });
    it("sessão em execução: Baileys da própria sessão", () => {
        getInstance.mockReturnValue({ sessionId: "s1", socket: makeSocket() });
        const p = getProvider("s1");
        expect(p).toBeInstanceOf(BaileysProvider);
        expect(p?.sessionId).toBe("s1");
        expect(getInstance).toHaveBeenCalledWith("s1");
    });
    it("instância sem socket: existe mas não está conectada", () => {
        getInstance.mockReturnValue({ sessionId: "s1", socket: null });
        expect(getProvider("s1")?.isConnected()).toBe(false);
    });
});
