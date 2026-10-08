import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { CloudApiProvider, sniffMime } from "./provider";
import { CloudApiError, WindowClosedError } from "./errors";
import { InMemoryWindowStore, isWindowOpen } from "./window";
import { FakeMetaServer, metaError } from "./fake-meta-server";

const TOKEN = "EAAG-token-secreto-de-teste-123456789";
const PNID = "106540352242922";
const SESSION = "sessao-cloud-1";
const PHONE = "5561999990001";
const NOW = new Date("2026-10-07T20:00:00Z");
const HOUR = 3600_000;

const server = new FakeMetaServer();
let store: InMemoryWindowStore;

beforeAll(() => server.start());
afterAll(() => server.stop());

function make(over: { timeoutMs?: number; baseUrl?: string } = {}) {
    return new CloudApiProvider({
        sessionId: SESSION,
        windowStore: store,
        now: () => NOW,
        config: { phoneNumberId: PNID, accessToken: TOKEN, apiVersion: "v25.0", baseUrl: over.baseUrl ?? server.baseUrl, timeoutMs: over.timeoutMs },
    });
}
const openWindow = (hoursAgo = 1, phone = PHONE) => store.record(SESSION, phone, new Date(NOW.getTime() - hoursAgo * HOUR));

beforeEach(() => {
    server.reset();
    store = new InMemoryWindowStore();
});

/** Captura o erro de uma chamada (falha se não lançar). */
async function thrown(p: Promise<unknown>): Promise<CloudApiError> {
    try {
        await p;
    } catch (e) {
        return e as CloudApiError;
    }
    throw new Error("era esperado um erro e nada foi lançado");
}

describe("identidade e capacidades", () => {
    it("declara só texto, mídia e template", () => {
        const p = make();
        expect(p.name).toBe("cloud-api");
        expect(p.sessionId).toBe(SESSION);
        expect(p.isConnected()).toBe(true);
        expect(p.capabilities).toMatchObject({ freeTextAnytime: false, templates: true, groups: false, polls: false, stickers: false, replies: false });
    });
    it("resolveRecipient normaliza para dígitos sem chamar a Meta", async () => {
        const p = make();
        expect(await p.resolveRecipient("+55 (61) 99999-0001")).toBe(PHONE);
        expect(await p.resolveRecipient(`${PHONE}@s.whatsapp.net`)).toBe(PHONE);
        expect(await p.resolveRecipient(`${PHONE}:12@s.whatsapp.net`)).toBe(PHONE);
        expect(server.requests).toHaveLength(0);
    });
    it("a configuração exige phoneNumberId e token", () => {
        expect(() => new CloudApiProvider({ sessionId: "s", windowStore: store, config: { phoneNumberId: "", accessToken: "t" } })).toThrow(CloudApiError);
        expect(() => new CloudApiProvider({ sessionId: "s", windowStore: store, config: { phoneNumberId: "1", accessToken: "" } })).toThrow(CloudApiError);
    });
});

describe("janela de 24 h", () => {
    it("isWindowOpen: dentro, na borda, fora e relógio no futuro", () => {
        const at = (ms: number) => new Date(NOW.getTime() - ms);
        expect(isWindowOpen(at(HOUR), NOW)).toBe(true);
        expect(isWindowOpen(at(24 * HOUR - 1000), NOW)).toBe(true);
        expect(isWindowOpen(at(24 * HOUR), NOW)).toBe(false);
        expect(isWindowOpen(at(25 * HOUR), NOW)).toBe(false);
        expect(isWindowOpen(at(-HOUR), NOW)).toBe(false); // futuro
        expect(isWindowOpen(null, NOW)).toBe(false);
    });
    it("texto livre fora da janela: erro claro e NENHUMA chamada à Meta", async () => {
        openWindow(30);
        const err = await thrown(make().sendText(PHONE, "oi"));
        expect(err).toBeInstanceOf(WindowClosedError);
        expect(err.kind).toBe("window_closed");
        expect(err.retryable).toBe(false);
        expect(err.message).toMatch(/Janela de atendimento de 24 h fechada/);
        expect((err as WindowClosedError).lastInboundAt?.toISOString()).toBe(new Date(NOW.getTime() - 30 * HOUR).toISOString());
        expect(server.requests).toHaveLength(0);
    });
    it("cliente que nunca escreveu: janela fechada, mensagem diz isso", async () => {
        const err = await thrown(make().sendText(PHONE, "oi"));
        expect(err).toBeInstanceOf(WindowClosedError);
        expect(err.message).toMatch(/nunca escreveu/);
        expect(server.requests).toHaveLength(0);
    });
    it("mídia fora da janela também é barrada antes de enviar ou subir arquivo", async () => {
        const err = await thrown(make().sendMedia(PHONE, { kind: "image", data: { url: "https://exemplo.test/a.jpg" } }));
        expect(err).toBeInstanceOf(WindowClosedError);
        expect(server.requests).toHaveLength(0);
    });
    it("a janela é por cliente: abrir a de um não libera o outro", async () => {
        openWindow(1, "5561999990002");
        expect(await thrown(make().sendText(PHONE, "oi"))).toBeInstanceOf(WindowClosedError);
    });
    it("a janela é por sessão: outra sessão não libera esta", async () => {
        store.record("outra-sessao", PHONE, new Date(NOW.getTime() - HOUR));
        expect(await thrown(make().sendText(PHONE, "oi"))).toBeInstanceOf(WindowClosedError);
    });
    it("dentro da janela envia", async () => {
        openWindow(23);
        await expect(make().sendText(PHONE, "oi")).resolves.toMatchObject({ messageId: expect.stringMatching(/^wamid\.FAKE/) });
        expect(server.requests).toHaveLength(1);
    });
});

describe("sendText", () => {
    it("chama POST /{versão}/{phone_number_id}/messages com o corpo e a autenticação certos", async () => {
        openWindow();
        const r = await make().sendText(`${PHONE}@s.whatsapp.net`, "Olá, tudo bem?");
        expect(r.messageId).toBe("wamid.FAKE1");
        expect(server.requests).toHaveLength(1);
        const req = server.requests[0];
        expect(req.method).toBe("POST");
        expect(req.path).toBe(`/v25.0/${PNID}/messages`);
        expect(req.headers.authorization).toBe(`Bearer ${TOKEN}`);
        expect(req.headers["content-type"]).toContain("application/json");
        expect(req.json).toEqual({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: PHONE,
            type: "text",
            text: { body: "Olá, tudo bem?", preview_url: false },
        });
    });
    it("acentos e emoji chegam intactos", async () => {
        openWindow();
        await make().sendText(PHONE, "Açaí 🍇 já saiu!");
        expect((server.requests[0].json as { text: { body: string } }).text.body).toBe("Açaí 🍇 já saiu!");
    });
});

describe("sendTemplate", () => {
    it("funciona fora da janela e sem consultar o histórico", async () => {
        const r = await make().sendTemplate(PHONE, { name: "pedido_pronto", languageCode: "pt_BR", bodyParameters: ["Maria", "42"] });
        expect(r.messageId).toBe("wamid.FAKE1");
        expect(server.requests[0].json).toEqual({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: PHONE,
            type: "template",
            template: {
                name: "pedido_pronto",
                language: { code: "pt_BR" },
                components: [{ type: "body", parameters: [{ type: "text", text: "Maria" }, { type: "text", text: "42" }] }],
            },
        });
    });
    it("sem parâmetros: sem components", async () => {
        await make().sendTemplate(PHONE, { name: "ola", languageCode: "pt_BR" });
        const t = (server.requests[0].json as { template: Record<string, unknown> }).template;
        expect(t).toEqual({ name: "ola", language: { code: "pt_BR" } });
    });
    it("components avançados são preservados e o corpo vem primeiro", async () => {
        await make().sendTemplate(PHONE, {
            name: "promo", languageCode: "pt_BR", bodyParameters: ["10%"],
            components: [{ type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "sim" }] }],
        });
        const comps = (server.requests[0].json as { template: { components: { type: string }[] } }).template.components;
        expect(comps.map((c) => c.type)).toEqual(["body", "button"]);
    });
    it("exige nome e idioma", async () => {
        expect((await thrown(make().sendTemplate(PHONE, { name: "", languageCode: "pt_BR" }))).kind).toBe("invalid_request");
        expect((await thrown(make().sendTemplate(PHONE, { name: "x", languageCode: "" }))).kind).toBe("invalid_request");
        expect(server.requests).toHaveLength(0);
    });
});

describe("sendMedia", () => {
    beforeEach(() => openWindow());

    it("imagem por link HTTPS, com legenda", async () => {
        await make().sendMedia(PHONE, { kind: "image", data: { url: "https://exemplo.test/a.jpg" }, caption: "Promo" });
        expect(server.requests).toHaveLength(1);
        expect(server.requests[0].json).toMatchObject({ type: "image", image: { link: "https://exemplo.test/a.jpg", caption: "Promo" } });
    });
    it("documento leva filename; áudio ignora legenda", async () => {
        await make().sendMedia(PHONE, { kind: "document", data: { url: "https://exemplo.test/c.pdf" }, caption: "c", fileName: "cardapio.pdf" });
        await make().sendMedia(PHONE, { kind: "audio", data: { url: "https://exemplo.test/a.ogg" }, caption: "ignorada" });
        expect(server.requests[0].json).toMatchObject({ type: "document", document: { link: "https://exemplo.test/c.pdf", caption: "c", filename: "cardapio.pdf" } });
        const audio = (server.requests[1].json as { audio: Record<string, unknown> }).audio;
        expect(audio).toEqual({ link: "https://exemplo.test/a.ogg" });
    });
    it("link que não é HTTPS é recusado sem chamar a Meta", async () => {
        const err = await thrown(make().sendMedia(PHONE, { kind: "image", data: { url: "http://exemplo.test/a.jpg" } }));
        expect(err.kind).toBe("invalid_request");
        expect(server.requests).toHaveLength(0);
    });
    it("arquivo em memória: sobe para /media (multipart) e envia pelo id", async () => {
        const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("corpo-da-imagem")]);
        const r = await make().sendMedia(PHONE, { kind: "image", data: png, caption: "Veja" });
        expect(server.requests).toHaveLength(2);
        const [upload, send] = server.requests;
        expect(upload.path).toBe(`/v25.0/${PNID}/media`);
        expect(upload.headers.authorization).toBe(`Bearer ${TOKEN}`);
        expect(upload.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
        const raw = upload.body.toString("latin1");
        expect(raw).toContain('name="messaging_product"');
        expect(raw).toContain("whatsapp");
        expect(raw).toContain('name="type"');
        expect(raw).toContain("image/png");
        expect(raw).toContain("corpo-da-imagem");
        expect(send.path).toBe(`/v25.0/${PNID}/messages`);
        expect(send.json).toMatchObject({ type: "image", image: { id: "MEDIA1", caption: "Veja" } });
        expect(r.messageId).toBe("wamid.FAKE2");
    });
    it("tipo desconhecido sem mimetype: erro claro e nada enviado (documento cai em octet-stream)", async () => {
        const unknown = Buffer.from("bytes-sem-assinatura-conhecida");
        const err = await thrown(make().sendMedia(PHONE, { kind: "image", data: unknown }));
        expect(err.kind).toBe("invalid_request");
        expect(err.message).toMatch(/mimetype/);
        expect(server.requests).toHaveLength(0);

        await make().sendMedia(PHONE, { kind: "document", data: unknown, fileName: "x.bin" });
        expect(server.requests[0].body.toString("latin1")).toContain("application/octet-stream");
    });
    it("mimetype informado vale mais que a detecção", async () => {
        await make().sendMedia(PHONE, { kind: "audio", data: Buffer.from("xx"), mimetype: "audio/mpeg" });
        expect(server.requests[0].body.toString("latin1")).toContain("audio/mpeg");
    });
});

describe("validação local (nada vai para a Meta)", () => {
    beforeEach(() => openWindow());

    it.each([["vazio", ""], ["só espaços", "   "]])("texto %s", async (_n, t) => {
        expect((await thrown(make().sendText(PHONE, t))).kind).toBe("invalid_request");
    });
    it("texto acima de 4096 caracteres", async () => {
        expect((await thrown(make().sendText(PHONE, "a".repeat(4097)))).kind).toBe("invalid_request");
        await expect(make().sendText(PHONE, "a".repeat(4096))).resolves.toBeDefined();
    });
    it("legenda acima de 1024 caracteres", async () => {
        const err = await thrown(make().sendMedia(PHONE, { kind: "image", data: { url: "https://x.test/a.jpg" }, caption: "a".repeat(1025) }));
        expect(err.kind).toBe("invalid_request");
    });
    it("grupo e canal não existem na Cloud API", async () => {
        expect((await thrown(make().sendText("120363123456789@g.us", "oi"))).kind).toBe("unsupported");
        expect((await thrown(make().sendText("123@newsletter", "oi"))).kind).toBe("unsupported");
    });
    it("cliente só com BSUID (telefone oculto): ainda não suportado, erro claro", async () => {
        const err = await thrown(make().sendText("BR.13491208655302741918", "oi"));
        expect(err.kind).toBe("unsupported");
        expect(err.message).toMatch(/BSUID/);
    });
    it.each(["", "abc", "123", "1".repeat(16)])("destino inválido %j", async (to) => {
        expect((await thrown(make().sendText(to, "oi"))).kind).toBe("invalid_request");
    });
    it("nenhuma validação local chama a Meta", async () => {
        const p = make();
        const calls: Promise<unknown>[] = [
            p.sendText(PHONE, ""),
            p.sendText(PHONE, "a".repeat(4097)),
            p.sendText("120363123456789@g.us", "oi"),
            p.sendText("BR.13491208655302741918", "oi"),
            p.sendText("123", "oi"),
            p.sendMedia(PHONE, { kind: "image", data: { url: "http://inseguro.test/a.jpg" } }),
            p.sendMedia(PHONE, { kind: "image", data: Buffer.from("sem-assinatura") }),
            p.sendTemplate(PHONE, { name: "", languageCode: "pt_BR" }),
        ];
        for (const c of calls) await expect(c).rejects.toBeInstanceOf(CloudApiError);
        expect(server.requests).toHaveLength(0);
    });
});

describe("erros da Meta", () => {
    beforeEach(() => openWindow());

    const cases: [string, number, number | null, string, boolean][] = [
        ["janela de 24 h", 400, 131047, "window_closed", false],
        ["token inválido (190)", 400, 190, "auth", false],
        ["não autorizado (401)", 401, null, "auth", false],
        ["limite de taxa (130429)", 429, 130429, "rate_limit", true],
        ["limite por par (131056)", 400, 131056, "rate_limit", true],
        ["não entregável (131026)", 400, 131026, "undeliverable", false],
        ["template inexistente (132001)", 400, 132001, "template", false],
        ["parâmetro inválido (100)", 400, 100, "invalid_request", false],
        ["erro interno (500)", 500, null, "server", true],
        ["serviço fora (503)", 503, null, "server", true],
    ];

    it.each(cases)("%s → %s/%s", async (_label, status, code, kind, retryable) => {
        server.enqueue({ status, body: code === null ? {} : metaError(code, "mensagem da Meta", { details: "detalhe", fbtrace_id: "TRACE1" }) });
        const err = await thrown(make().sendText(PHONE, "oi"));
        expect(err).toBeInstanceOf(CloudApiError);
        expect(err.kind).toBe(kind);
        expect(err.retryable).toBe(retryable);
        expect(err.status).toBe(status);
        expect(err.code).toBe(code);
        if (code !== null) {
            expect(err.details).toBe("detalhe");
            expect(err.fbtraceId).toBe("TRACE1");
            expect(err.message).toContain("mensagem da Meta");
        }
    });

    it("corpo de erro que não é JSON: ainda classifica pelo status", async () => {
        server.enqueue({ status: 502, body: "<html>Bad Gateway</html>" });
        const err = await thrown(make().sendText(PHONE, "oi"));
        expect(err.kind).toBe("server");
        expect(err.message).toMatch(/HTTP 502/);
    });
    it("sucesso sem id da mensagem: resposta inesperada, não repete", async () => {
        server.enqueue({ status: 200, body: { messaging_product: "whatsapp", messages: [] } });
        const err = await thrown(make().sendText(PHONE, "oi"));
        expect(err.kind).toBe("unexpected_response");
        expect(err.retryable).toBe(false);
    });
    it("upload sem id: resposta inesperada", async () => {
        server.enqueue({ status: 200, body: {} });
        const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("x")]);
        expect((await thrown(make().sendMedia(PHONE, { kind: "image", data: png }))).kind).toBe("unexpected_response");
        expect(server.requests).toHaveLength(1); // não tentou enviar a mensagem
    });
    it("falha no upload da mídia interrompe antes de enviar a mensagem", async () => {
        server.enqueue({ status: 400, body: metaError(131053, "Media upload error") });
        const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("x")]);
        await thrown(make().sendMedia(PHONE, { kind: "image", data: png }));
        expect(server.requests.map((r) => r.path)).toEqual([`/v25.0/${PNID}/media`]);
    });
});

describe("rede e tempo", () => {
    beforeEach(() => openWindow());

    it("sem conexão: erro de rede, repetível, sem vazar o token", async () => {
        const err = await thrown(make({ baseUrl: "http://127.0.0.1:1" }).sendText(PHONE, "oi"));
        expect(err.kind).toBe("network");
        expect(err.retryable).toBe(true);
    });
    it("tempo esgotado", async () => {
        server.enqueue({ status: 200, body: {}, delayMs: 400 });
        const err = await thrown(make({ timeoutMs: 50 }).sendText(PHONE, "oi"));
        expect(err.kind).toBe("network");
        expect(err.message).toMatch(/Tempo esgotado/);
    });
});

describe("o token de acesso nunca vaza", () => {
    beforeEach(() => openWindow());

    it("não aparece em mensagem, JSON, pilha nem propriedades de nenhum tipo de erro", async () => {
        const errors: CloudApiError[] = [];
        for (const [status, code] of [[400, 131047], [401, 190], [429, 130429], [500, null]] as [number, number | null][]) {
            server.enqueue({ status, body: code === null ? {} : metaError(code, "falha") });
            errors.push(await thrown(make().sendText(PHONE, "oi")));
        }
        errors.push(await thrown(make({ baseUrl: "http://127.0.0.1:1" }).sendText(PHONE, "oi")));
        errors.push(await thrown(make().sendText("120363@g.us", "oi")));
        for (const e of errors) {
            const dump = `${e.message}\n${e.stack}\n${JSON.stringify(e)}\n${Object.values(e).join("|")}`;
            expect(dump).not.toContain(TOKEN);
            expect(dump.toLowerCase()).not.toContain("bearer");
        }
    });
});

describe("sniffMime", () => {
    it.each([
        ["JPEG", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), "image/jpeg"],
        ["PNG", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), "image/png"],
        ["PDF", Buffer.from("%PDF-1.7"), "application/pdf"],
        ["MP4", Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(4)]), "video/mp4"],
        ["OGG", Buffer.from("OggS\u0000\u0002"), "audio/ogg"],
    ])("reconhece %s", (_n, buf, mime) => {
        expect(sniffMime(buf)).toBe(mime);
    });
    it("desconhecido e vazio: null", () => {
        expect(sniffMime(Buffer.from("texto qualquer"))).toBeNull();
        expect(sniffMime(Buffer.alloc(0))).toBeNull();
    });
});

describe("sendTemplate com botão (modelo de autenticação)", () => {
    it("o código vai no corpo E no botão de URL índice 0", async () => {
        await make().sendTemplate(PHONE, { name: "codigo_verificacao", languageCode: "pt_BR", bodyParameters: ["123456"], buttonParameters: ["123456"] });
        expect((server.requests[0].json as { template: object }).template).toEqual({
            name: "codigo_verificacao",
            language: { code: "pt_BR" },
            components: [
                { type: "body", parameters: [{ type: "text", text: "123456" }] },
                { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] },
            ],
        });
    });
    it("sem buttonParameters o payload é idêntico ao de antes (regressão)", async () => {
        await make().sendTemplate(PHONE, { name: "pedido_em_preparo", languageCode: "pt_BR", bodyParameters: ["Maria", "42", "Açaí"] });
        const comps = (server.requests[0].json as { template: { components: { type: string }[] } }).template.components;
        expect(comps.map((c) => c.type)).toEqual(["body"]);
    });
    it("buttonParameters vazio não cria componente de botão", async () => {
        await make().sendTemplate(PHONE, { name: "x", languageCode: "pt_BR", buttonParameters: [] });
        expect((server.requests[0].json as { template: object }).template).toEqual({ name: "x", language: { code: "pt_BR" } });
    });
    it("parâmetro de botão vazio é recusado sem chamar a Meta", async () => {
        const err = await thrown(make().sendTemplate(PHONE, { name: "x", languageCode: "pt_BR", buttonParameters: [""] }));
        expect(err.kind).toBe("invalid_request");
        expect(server.requests).toHaveLength(0);
    });
});
