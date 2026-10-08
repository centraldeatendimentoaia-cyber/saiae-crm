import { describe, it, expect } from "vitest";
import {
    normalizeMetaWebhook,
    type InboundMessage,
    type StatusUpdate,
    type SystemError,
} from "./inbound";
import * as fx from "./fixtures";

const one = (payload: unknown) => {
    const { events, ignored } = normalizeMetaWebhook(payload);
    expect(events).toHaveLength(1);
    expect(ignored).toBe(0);
    return events[0];
};
const msg = (payload: unknown) => {
    const e = one(payload);
    expect(e.kind).toBe("message");
    return e as InboundMessage;
};
const status = (payload: unknown) => {
    const e = one(payload);
    expect(e.kind).toBe("status");
    return e as StatusUpdate;
};

describe("mensagem de texto", () => {
    it("normaliza remetente, loja, horário e texto", () => {
        const m = msg(fx.textMessage);
        expect(m).toMatchObject({
            kind: "message", provider: "cloud-api", type: "text", rawType: "text", text: "Tem açaí de 500ml?",
            messageId: "wamid.HBgNNTU2MTk5OTk5MDAwMRUCABIYFDNB",
            phoneNumberId: "106540352242922", displayPhone: "15550001111",
            from: { phone: "5561999990001", userId: null, name: "Maria Teste", contactKey: "5561999990001" },
            media: null, location: null, replyToMessageId: null, forwarded: false, referral: null, errors: [],
        });
        expect(m.timestamp.toISOString()).toBe(new Date(1749416383 * 1000).toISOString());
    });
    it("resposta citada e encaminhada", () => {
        const m = msg(fx.replyWithContext);
        expect(m.replyToMessageId).toBe("wamid.CITADA");
        expect(m.forwarded).toBe(true);
    });
    it("origem de anúncio (click-to-WhatsApp) é preservada para atribuição", () => {
        expect(msg(fx.adReferralMessage).referral).toEqual({
            sourceUrl: "https://fb.me/anuncio", sourceId: "120000001", sourceType: "ad",
            ctwaClid: "ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNpxs",
        });
    });
});

describe("mídia", () => {
    it("imagem com legenda", () => {
        const m = msg(fx.imageMessage);
        expect(m).toMatchObject({ type: "image", text: "Olha esse", media: { id: "5001", mimeType: "image/jpeg", sha256: "abc123", fileName: null } });
    });
    it("áudio gravado na hora vira voice", () => {
        const m = msg(fx.audioVoiceMessage);
        expect(m.type).toBe("voice");
        expect(m.rawType).toBe("audio");
        expect(m.media?.id).toBe("5002");
    });
    it("documento com nome do arquivo", () => {
        expect(msg(fx.documentMessage)).toMatchObject({ type: "document", text: "segue", media: { fileName: "cardapio.pdf", mimeType: "application/pdf" } });
    });
    it("figurinha", () => {
        expect(msg(fx.stickerMessage)).toMatchObject({ type: "sticker", media: { id: "5004" } });
    });
    it("mídia sem id não vira mensagem de mídia (nada para baixar)", () => {
        const bad = fx.envelope({ contacts: [{ wa_id: "5561999990001" }], messages: [{ from: "5561999990001", id: "w1", timestamp: "1", type: "image", image: { caption: "x" } }] });
        const m = msg(bad);
        expect(m.type).toBe("image");
        expect(m.media).toBeNull();
    });
});

describe("outros tipos", () => {
    it("localização", () => {
        expect(msg(fx.locationMessage)).toMatchObject({ type: "location", location: { latitude: -15.7801, longitude: -47.9292, name: "Casa", address: "Asa Sul, Brasília" } });
    });
    it("localização sem coordenadas vira unsupported", () => {
        const bad = fx.envelope({ contacts: [{ wa_id: "5561999990001" }], messages: [{ from: "5561999990001", id: "w", timestamp: "1", type: "location", location: { name: "x" } }] });
        expect(msg(bad).type).toBe("unsupported");
    });
    it("contatos compartilhados", () => {
        expect(msg(fx.contactsMessage)).toMatchObject({ type: "contacts", contacts: [{ name: "João Amigo", phones: ["5561999990002"] }] });
    });
    it("resposta de botão", () => {
        expect(msg(fx.buttonReplyMessage)).toMatchObject({ type: "button_reply", replyId: "confirmar", text: "Confirmar" });
    });
    it("resposta de lista", () => {
        expect(msg(fx.listReplyMessage)).toMatchObject({ type: "list_reply", replyId: "item-7", text: "Açaí 300ml" });
    });
    it("botão de resposta rápida de template", () => {
        expect(msg(fx.templateButtonMessage)).toMatchObject({ type: "button_reply", replyId: "avaliar-5", text: "Nota 5" });
    });
    it("reação e reação removida", () => {
        expect(msg(fx.reactionMessage)).toMatchObject({ type: "reaction", reaction: { messageId: "wamid.ORIGINAL", emoji: "👍" } });
        expect(msg(fx.reactionRemoved).reaction).toEqual({ messageId: "wamid.ORIGINAL", emoji: null });
    });
    it("tipo não suportado carrega o erro da Meta", () => {
        const m = msg(fx.unsupportedMessage);
        expect(m.type).toBe("unsupported");
        expect(m.errors).toEqual([{ code: 131051, title: "Message type is not supported", message: "Message type is not supported", details: "Message type unknown" }]);
    });
    it("tipo desconhecido (pedido, etc.): unsupported, mas guarda o tipo bruto", () => {
        const m = msg(fx.orderMessage);
        expect(m.type).toBe("unsupported");
        expect(m.rawType).toBe("order");
    });
});

describe("identidade do cliente (telefone oculto e BSUID)", () => {
    it("só BSUID: telefone nulo e contactKey = BSUID", () => {
        const m = msg(fx.bsuidOnlyMessage);
        expect(m.from).toEqual({
            phone: null, userId: "BR.13491208655302741918", username: "@cliente.oculto", name: "Cliente Oculto",
            contactKey: "BR.13491208655302741918",
        });
    });
    it("telefone e BSUID juntos: contactKey = telefone, BSUID guardado ao lado", () => {
        const m = msg(fx.phoneAndBsuidMessage);
        expect(m.from).toMatchObject({ phone: "5561999990001", userId: "BR.9988776655443322", contactKey: "5561999990001" });
    });
    it("remetente sem telefone nem BSUID reconhecível é descartado, nunca inventado", () => {
        const bad = fx.envelope({ messages: [{ from: "???", id: "w", timestamp: "1", type: "text", text: { body: "x" } }] });
        const { events, ignored } = normalizeMetaWebhook(bad);
        expect(events).toEqual([]);
        expect(ignored).toBe(1);
    });
    it("nome do perfil é o do contato certo quando há vários", () => {
        const payload = fx.envelope({
            contacts: [{ profile: { name: "Outro" }, wa_id: "5561999990009" }, { profile: { name: "Maria Teste" }, wa_id: "5561999990001" }],
            messages: [{ from: "5561999990001", id: "w", timestamp: "1", type: "text", text: { body: "x" } }],
        });
        expect(msg(payload).from.name).toBe("Maria Teste");
    });
    it("vários contatos e nenhum casa com o remetente: nome nulo, nunca o de outra pessoa", () => {
        const payload = fx.envelope({
            contacts: [{ profile: { name: "Outro 1" }, wa_id: "5561999990008" }, { profile: { name: "Outro 2" }, wa_id: "5561999990009" }],
            messages: [{ from: "5561999990001", id: "w", timestamp: "1", type: "text", text: { body: "x" } }],
        });
        expect(msg(payload).from.name).toBeNull();
    });
    it("funciona sem a lista de contatos (nome nulo)", () => {
        const payload = fx.envelope({ messages: [{ from: "5561999990001", id: "w", timestamp: "1", type: "text", text: { body: "x" } }] });
        expect(msg(payload).from).toMatchObject({ phone: "5561999990001", name: null });
    });
});

describe("status de entrega", () => {
    it("sent com dados de cobrança", () => {
        const s = status(fx.statusSent);
        expect(s).toMatchObject({
            messageId: "wamid.SAIDA1", status: "sent", phoneNumberId: "106540352242922",
            recipient: { phone: "5561999990001", userId: null, contactKey: "5561999990001" },
            error: null, billing: { category: "service", billable: true },
        });
        expect(s.timestamp.toISOString()).toBe(new Date(1750263773 * 1000).toISOString());
    });
    it("delivered", () => expect(status(fx.statusDelivered).status).toBe("delivered"));
    it("read, sem cobrança", () => {
        const s = status(fx.statusRead);
        expect(s.status).toBe("read");
        expect(s.billing).toBeNull();
    });
    it("failed traz o erro (aqui: fora da janela de 24 h, código 131047)", () => {
        const s = status(fx.statusFailed);
        expect(s.status).toBe("failed");
        expect(s.error).toMatchObject({ code: 131047, title: "Re-engagement message" });
        expect(s.error?.details).toMatch(/24 hours/);
    });
    it("destinatário só com BSUID", () => {
        expect(status(fx.statusBsuidRecipient).recipient).toEqual({ phone: null, userId: "BR.13491208655302741918", contactKey: "BR.13491208655302741918" });
    });
    it("status desconhecido é descartado e contado", () => {
        const odd = fx.envelope({ statuses: [{ id: "w", status: "deleted", recipient_id: "5561999990001", timestamp: "1" }] });
        const { events, ignored } = normalizeMetaWebhook(odd);
        expect(events).toEqual([]);
        expect(ignored).toBe(1);
    });
});

describe("lote e erros do sistema", () => {
    it("mensagens e status no mesmo POST", () => {
        const { events, ignored } = normalizeMetaWebhook(fx.mixedBatch);
        expect(ignored).toBe(0);
        expect(events.map((e) => e.kind)).toEqual(["message", "message", "status"]);
    });
    it("erro de sistema/conta vira evento error", () => {
        const e = one(fx.systemError) as SystemError;
        expect(e).toMatchObject({ kind: "error", error: { code: 131000, title: "Something went wrong", details: "Internal error" } });
    });
    it("campo diferente de messages é ignorado e contado", () => {
        const { events, ignored } = normalizeMetaWebhook(fx.otherField);
        expect(events).toEqual([]);
        expect(ignored).toBe(1);
    });
});

describe("robustez (nunca lança, nunca muta)", () => {
    it.each([null, undefined, 42, "texto", [], {}, { object: "page" }, { object: "whatsapp_business_account" }, { object: "whatsapp_business_account", entry: "x" }])(
        "entrada inválida %j não lança",
        (input) => {
            expect(() => normalizeMetaWebhook(input)).not.toThrow();
            expect(normalizeMetaWebhook(input).events).toEqual([]);
        }
    );
    it("um item ruim não derruba os bons do mesmo lote", () => {
        const payload = fx.envelope({
            contacts: [{ wa_id: "5561999990001" }],
            messages: [null, { id: "sem-tipo" }, { from: "5561999990001", id: "ok", timestamp: "1", type: "text", text: { body: "bom" } }],
        });
        const { events, ignored } = normalizeMetaWebhook(payload);
        expect(events).toHaveLength(1);
        expect(ignored).toBe(2);
    });
    it("timestamp inválido usa a hora atual em vez de quebrar", () => {
        const payload = fx.envelope({ messages: [{ from: "5561999990001", id: "w", timestamp: "abc", type: "text", text: { body: "x" } }] });
        expect(msg(payload).timestamp.getTime()).toBeGreaterThan(Date.now() - 5000);
    });
    it("não altera o payload de entrada", () => {
        const copy = JSON.parse(JSON.stringify(fx.mixedBatch));
        normalizeMetaWebhook(fx.mixedBatch);
        expect(fx.mixedBatch).toEqual(copy);
    });
    it("é determinístico: a mesma entrada gera os mesmos eventos", () => {
        const a = normalizeMetaWebhook(fx.textMessage);
        const b = normalizeMetaWebhook(fx.textMessage);
        expect(a).toEqual(b);
    });
});
