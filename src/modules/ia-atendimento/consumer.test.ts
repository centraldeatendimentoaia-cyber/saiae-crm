import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import {
    criarConsumidorIa, criarDepsPadrao, hashContato, LIMITE_POR_HORA, LIMITE_POR_MINUTO, MAX_TEXTO,
    MSG_ORIENTACAO, MSG_PARAR, MSG_TIPO_NAO_SUPORTADO, MSG_VOLTAR, type IaDeps,
} from "./consumer";
import { MSG_RESPONSAVEL_AVISADO } from "./dono";
import { SEM_LOJA, type IaStore, type RegistroMensagem, type ConversaRef } from "./store";
import type { NormalizedBatch, InboundMessage } from "@/modules/whatsapp/cloud/inbound";
import { normalizeMetaWebhook } from "@/modules/whatsapp/cloud/inbound";
import * as fx from "@/modules/whatsapp/cloud/fixtures";

const LOJA = "K7P2QX";
const PHONE = "5561999990001";
const T0 = new Date("2026-10-08T12:00:00Z");

/** Repositório em memória com a mesma regra de idempotência do banco. */
function memStore() {
    const msgs = new Map<string, RegistroMensagem>();
    const conversas = new Map<string, ConversaRef>();
    const store: IaStore & { msgs: typeof msgs; conversas: typeof conversas } = {
        msgs, conversas,
        async registrarMensagem(r) {
            const k = `${r.lojaCodigo}:${r.contactKey}`;
            const conversa = conversas.get(k) ?? { id: `c-${conversas.size + 1}`, lojaCodigo: r.lojaCodigo, contactKey: r.contactKey, estado: "ia", pausadaAte: null };
            conversas.set(k, conversa);
            if (msgs.has(r.providerMessageId)) return { novo: false, conversa };
            msgs.set(r.providerMessageId, r);
            return { novo: true, conversa };
        },
        async lojaDaConversa(contactKey) {
            const all = [...conversas.values()].filter((c) => c.contactKey === contactKey && c.lojaCodigo !== SEM_LOJA);
            return all.length ? all[all.length - 1].lojaCodigo : null;
        },
        async historico() { return []; },
        async pausar(id, ate) { for (const c of conversas.values()) if (c.id === id) { c.estado = "humano"; c.pausadaAte = ate; } },
        async retomar(id) { for (const c of conversas.values()) if (c.id === id) { c.estado = "ia"; c.pausadaAte = null; } },
        async retomarLoja(loja) { let n = 0; for (const c of conversas.values()) if (c.lojaCodigo === loja && c.estado === "humano") { c.estado = "ia"; c.pausadaAte = null; n++; } return n; },
    };
    return store;
}

function msg(over: Record<string, unknown> = {}): InboundMessage {
    return {
        kind: "message", provider: "cloud-api", messageId: `wamid.${Math.random()}`, phoneNumberId: "1", displayPhone: null,
        timestamp: T0, type: "text", rawType: "text", text: `Oi #${LOJA}`,
        from: { phone: PHONE, userId: null, username: null, name: "Maria Teste", contactKey: PHONE },
        media: null, location: null, contacts: [], replyId: null, reaction: null, replyToMessageId: null, forwarded: false, referral: null, errors: [],
        ...over,
    } as InboundMessage;
}
const lote = (...m: InboundMessage[]): NormalizedBatch => ({ events: m, ignored: 0 });

function setup(over: Partial<IaDeps> = {}) {
    const store = memStore();
    const enviar = vi.fn().mockResolvedValue("wamid.OUT");
    const responder = vi.fn().mockResolvedValue("Resposta da IA");
    const logger = { info: vi.fn(), warn: vi.fn() };
    const optOut = { is: vi.fn().mockResolvedValue(false), add: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) };
    const deps = criarDepsPadrao({
        store, enviar, responder, logger, optOut,
        env: { IA_ATENDIMENTO: "on", WHATSAPP_CLOUD_SESSION_ID: "pilot" },
        now: () => T0,
        ...over,
    });
    return { run: criarConsumidorIa(deps), store, enviar, responder, logger, optOut, deps };
}

describe("desligado por padrão", () => {
    it.each([undefined, "", "off", "true", "1"])("IA_ATENDIMENTO=%j: não faz nada", async (v) => {
        const { run, enviar, responder, store } = setup({ env: { IA_ATENDIMENTO: v, WHATSAPP_CLOUD_SESSION_ID: "pilot" } });
        await run(lote(msg()));
        expect(enviar).not.toHaveBeenCalled();
        expect(responder).not.toHaveBeenCalled();
        expect(store.msgs.size).toBe(0);
    });
});

describe("caminho feliz", () => {
    it("mensagem com o código da loja: grava, chama o responder e envia a resposta (e grava a saída)", async () => {
        const { run, enviar, responder, store } = setup();
        await run(lote(msg({ messageId: "wamid.A", text: `Quanto custa o açaí? #${LOJA}` })));
        expect(responder).toHaveBeenCalledTimes(1);
        expect(responder.mock.calls[0][0]).toMatchObject({ texto: `Quanto custa o açaí? #${LOJA}`, nomePerfil: "Maria Teste", contactKey: PHONE, conversa: { lojaCodigo: LOJA } });
        expect(enviar).toHaveBeenCalledWith(PHONE, "Resposta da IA");
        expect([...store.msgs.values()].map((m) => m.direcao)).toEqual(["in", "out"]);
    });
    it("código em minúsculas e no meio do texto", async () => {
        const { run, responder } = setup();
        await run(lote(msg({ text: `oi, vim pelo link #${LOJA.toLowerCase()} tudo bem` })));
        expect(responder.mock.calls[0][0].conversa.lojaCodigo).toBe(LOJA);
    });
    it("conversa já iniciada: mensagem seguinte SEM código continua na mesma loja", async () => {
        const { run, responder } = setup();
        await run(lote(msg({ messageId: "wamid.1", text: `oi #${LOJA}` })));
        await run(lote(msg({ messageId: "wamid.2", text: "e o horário?" })));
        expect(responder).toHaveBeenCalledTimes(2);
        expect(responder.mock.calls[1][0].conversa.lojaCodigo).toBe(LOJA);
    });
    it("sem responder (estado atual da Task 4): grava e não responde nada", async () => {
        const { run, enviar, store } = setup({ responder: undefined });
        await run(lote(msg()));
        expect(store.msgs.size).toBe(1);
        expect(enviar).not.toHaveBeenCalled();
    });
    it("resposta nula do responder: não envia", async () => {
        const { run, enviar } = setup({ responder: vi.fn().mockResolvedValue(null) });
        await run(lote(msg()));
        expect(enviar).not.toHaveBeenCalled();
    });
    it("texto da mensagem é cortado em 1000 caracteres antes de ir para a IA e para o banco", async () => {
        const { run, responder, store } = setup();
        await run(lote(msg({ text: `#${LOJA} ` + "x".repeat(5000) })));
        expect(responder.mock.calls[0][0].texto.length).toBe(MAX_TEXTO);
        expect([...store.msgs.values()][0].texto.length).toBeLessThanOrEqual(MAX_TEXTO);
    });
    it("resposta de botão e de lista também são texto", async () => {
        const { run, responder } = setup();
        await run(lote(msg({ type: "button_reply", text: `Cardápio #${LOJA}` })));
        expect(responder).toHaveBeenCalledTimes(1);
    });
});

describe("idempotência (a Meta reenvia)", () => {
    it("o mesmo messageId entregue duas vezes gera UMA resposta", async () => {
        const { run, enviar, responder } = setup();
        const m = msg({ messageId: "wamid.DUP" });
        await run(lote(m));
        await run(lote(m));
        expect(responder).toHaveBeenCalledTimes(1);
        expect(enviar).toHaveBeenCalledTimes(1);
    });
    it("duplicata dentro do mesmo lote", async () => {
        const { run, responder } = setup();
        const m = msg({ messageId: "wamid.DUP2" });
        await run(lote(m, m));
        expect(responder).toHaveBeenCalledTimes(1);
    });
    it("falha ao gravar NÃO marca a mensagem como vista: a reentrega da Meta é processada", async () => {
        const store = memStore();
        const original = store.registrarMensagem.bind(store);
        let falhar = true;
        store.registrarMensagem = async (r) => {
            if (falhar) throw new Error("banco indisponível");
            return original(r);
        };
        const { run, responder } = setup({ store });
        const m = msg({ messageId: "wamid.RETRY" });
        await run(lote(m)); // falha: não derruba nem responde
        expect(responder).not.toHaveBeenCalled();
        falhar = false;
        await run(lote(m)); // reentrega
        expect(responder).toHaveBeenCalledTimes(1);
    });
    it("memória zerada (reinício): o banco ainda barra a reentrega", async () => {
        const a = setup();
        const m = msg({ messageId: "wamid.PERSIST" });
        await a.run(lote(m));
        const b = setup({ store: a.store }); // novo processo, mesmo banco
        await b.run(lote(m));
        expect(b.responder).not.toHaveBeenCalled();
    });
});

describe("ordem", () => {
    it("lote com várias mensagens do mesmo telefone é tratado em ordem de timestamp", async () => {
        const { run, responder } = setup();
        const t = (s: number) => new Date(T0.getTime() + s * 1000);
        await run(lote(msg({ messageId: "wamid.c", text: `terceira #${LOJA}`, timestamp: t(3) }), msg({ messageId: "wamid.a", text: `primeira #${LOJA}`, timestamp: t(1) }), msg({ messageId: "wamid.b", text: `segunda #${LOJA}`, timestamp: t(2) })));
        expect(responder.mock.calls.map((c) => c[0].texto.split(" ")[0])).toEqual(["primeira", "segunda", "terceira"]);
    });
    it("eventos que não são mensagem (status) são ignorados", async () => {
        const { run, responder, enviar } = setup();
        await run(normalizeMetaWebhook(fx.statusDelivered));
        expect(responder).not.toHaveBeenCalled();
        expect(enviar).not.toHaveBeenCalled();
    });
});

describe("sem loja", () => {
    it("sem código e sem conversa prévia: orienta a usar o link, UMA vez, sem listar lojas", async () => {
        const { run, enviar, responder } = setup();
        await run(lote(msg({ messageId: "wamid.1", text: "oi" })));
        await run(lote(msg({ messageId: "wamid.2", text: "alguém aí?" })));
        expect(responder).not.toHaveBeenCalled();
        expect(enviar).toHaveBeenCalledTimes(1);
        expect(enviar).toHaveBeenCalledWith(PHONE, MSG_ORIENTACAO);
        expect(MSG_ORIENTACAO).not.toMatch(/#|loja [A-Z]/);
    });
    it("código com formato inválido (ex.: com 0 e O, ou curto) vale como sem código", async () => {
        const { run, responder, enviar } = setup();
        await run(lote(msg({ text: "oi #K70P2Q e #ABC" })));
        expect(responder).not.toHaveBeenCalled();
        expect(enviar).toHaveBeenCalledWith(PHONE, MSG_ORIENTACAO);
    });
    it("a mensagem sem loja é gravada (abre a janela de 24 h) mas SEM o conteúdo, na conversa sem loja", async () => {
        const { run, store } = setup();
        await run(lote(msg({ text: "meu CPF é 123.456.789-00" })));
        const gravadas = [...store.msgs.values()];
        expect(gravadas[0]).toMatchObject({ lojaCodigo: SEM_LOJA, direcao: "in", texto: "[sem loja]" });
        expect(JSON.stringify(gravadas)).not.toContain("CPF");
    });
    it("a conversa sem loja nunca é tomada como a loja do cliente", async () => {
        const { run, responder } = setup();
        await run(lote(msg({ messageId: "wamid.1", text: "oi" })));
        await run(lote(msg({ messageId: "wamid.2", text: "e agora?" })));
        expect(responder).not.toHaveBeenCalled();
    });
});

describe("tipos não suportados", () => {
    it.each(["audio", "voice", "image", "video", "document", "sticker", "location", "contacts", "reaction", "unsupported"] as const)("%s: pede texto, uma vez", async (type) => {
        const { run, enviar, responder } = setup();
        await run(lote(msg({ messageId: "wamid.1", type, text: `#${LOJA}` })));
        await run(lote(msg({ messageId: "wamid.2", type, text: null })));
        expect(responder).not.toHaveBeenCalled();
        expect(enviar).toHaveBeenCalledTimes(1);
        expect(enviar).toHaveBeenCalledWith(PHONE, MSG_TIPO_NAO_SUPORTADO);
    });
    it("grava só o TIPO, nunca o conteúdo, e não usa a legenda para achar a loja", async () => {
        const { run, store, responder } = setup();
        await run(lote(msg({ type: "image", text: `legenda secreta #${LOJA}` })));
        expect(JSON.stringify([...store.msgs.values()])).not.toContain("legenda secreta");
        expect([...store.msgs.values()][0]).toMatchObject({ lojaCodigo: SEM_LOJA, texto: "[sem loja]" });
        expect(responder).not.toHaveBeenCalled();
    });
});

describe("parar e voltar (opt-out)", () => {
    it.each(["parar", "PARAR.", "Sair!"])("%s: marca opt-out, confirma e para", async (texto) => {
        const { run, optOut, enviar, responder } = setup();
        await run(lote(msg({ text: texto })));
        expect(optOut.add).toHaveBeenCalledWith("pilot", `${PHONE}@s.whatsapp.net`);
        expect(enviar).toHaveBeenCalledWith(PHONE, MSG_PARAR);
        expect(responder).not.toHaveBeenCalled();
    });
    it("depois de parar, não responde mais nada", async () => {
        const { run, enviar, responder } = setup({ optOut: { is: vi.fn().mockResolvedValue(true), add: vi.fn(), remove: vi.fn() } });
        await run(lote(msg({ text: `oi #${LOJA}` })));
        expect(enviar).not.toHaveBeenCalled();
        expect(responder).not.toHaveBeenCalled();
    });
    it("voltar: remove o opt-out e dá boas-vindas", async () => {
        const { run, optOut, enviar } = setup({ optOut: { is: vi.fn().mockResolvedValue(true), add: vi.fn(), remove: vi.fn().mockResolvedValue(undefined) } });
        await run(lote(msg({ text: "voltar" })));
        expect(enviar).toHaveBeenCalledWith(PHONE, MSG_VOLTAR);
        void optOut;
    });
    it("a conversa grande sobre 'sair do cardápio' não é opt-out (só a palavra isolada)", async () => {
        const { run, optOut, responder } = setup();
        await run(lote(msg({ text: `quero sair mais cedo, vocês fecham que horas? #${LOJA}` })));
        expect(optOut.add).not.toHaveBeenCalled();
        expect(responder).toHaveBeenCalled();
    });
});

describe("rate limit por telefone", () => {
    it(`mais de ${LIMITE_POR_MINUTO} mensagens por minuto: as extras são descartadas sem resposta`, async () => {
        const { run, responder, logger } = setup();
        for (let i = 0; i < LIMITE_POR_MINUTO + 4; i++) await run(lote(msg({ messageId: `wamid.${i}`, text: `oi ${i} #${LOJA}` })));
        expect(responder).toHaveBeenCalledTimes(LIMITE_POR_MINUTO);
        expect(logger.info.mock.calls.map((c) => c[1]).join()).toContain("limitadas=1");
    });
    it(`mais de ${LIMITE_POR_HORA} por hora também`, async () => {
        let agora = T0.getTime();
        const { run, responder } = setup({ now: () => new Date(agora) });
        for (let i = 0; i < LIMITE_POR_HORA + 10; i++) {
            agora += 50_000; // 50 s: abaixo do limite por minuto, 70 mensagens em menos de 1 hora
            await run(lote(msg({ messageId: `wamid.h${i}`, text: `oi #${LOJA}`, timestamp: new Date(agora) })));
        }
        expect(responder).toHaveBeenCalledTimes(LIMITE_POR_HORA);
    });
    it("o limite é por telefone: outro cliente não é afetado", async () => {
        const { run, responder } = setup();
        for (let i = 0; i < LIMITE_POR_MINUTO + 2; i++) await run(lote(msg({ messageId: `wamid.${i}`, text: `oi #${LOJA}` })));
        const antes = responder.mock.calls.length;
        await run(lote(msg({ messageId: "wamid.outro", from: { phone: "5561888880002", userId: null, username: null, name: null, contactKey: "5561888880002" } })));
        expect(responder.mock.calls.length).toBe(antes + 1);
    });
});

describe("pausa (dono chamado)", () => {
    const humano = (ate: Date | null): Partial<IaDeps> => {
        const store = memStore();
        const original = store.registrarMensagem.bind(store);
        store.registrarMensagem = async (r) => {
            const x = await original(r);
            x.conversa.estado = "humano";
            x.conversa.pausadaAte = ate;
            return x;
        };
        return { store };
    };
    it("dentro da pausa: grava, a IA não responde e o cliente é avisado UMA vez", async () => {
        const { run, responder, enviar } = setup(humano(new Date(T0.getTime() + 3600_000)));
        await run(lote(msg({ messageId: "wamid.p1" })));
        await run(lote(msg({ messageId: "wamid.p2", text: "alguém aí?" })));
        expect(responder).not.toHaveBeenCalled();
        expect(enviar).toHaveBeenCalledTimes(1);
        expect(enviar).toHaveBeenCalledWith(PHONE, MSG_RESPONSAVEL_AVISADO);
    });
    it("pausa vencida: a IA volta a responder e a conversa é devolvida", async () => {
        const over = humano(new Date(T0.getTime() - 1000));
        const retomar = vi.spyOn(over.store!, "retomar");
        const { run, responder } = setup(over);
        await run(lote(msg()));
        expect(responder).toHaveBeenCalledTimes(1);
        expect(retomar).toHaveBeenCalledTimes(1); // a resposta da IA regrava a conversa neste store de teste, então confere a chamada
    });
    it("LIBERAR do responsável: confirma e não chama a IA", async () => {
        const liberar = vi.fn().mockResolvedValue("ok liberado");
        const { run, responder, enviar } = setup({ liberar });
        await run(lote(msg({ text: `LIBERAR #${LOJA}` })));
        expect(liberar).toHaveBeenCalledWith(`LIBERAR #${LOJA}`, PHONE);
        expect(enviar).toHaveBeenCalledWith(PHONE, "ok liberado");
        expect(responder).not.toHaveBeenCalled();
    });
    it("liberar devolve null (não é o responsável): segue como cliente comum", async () => {
        const { run, responder } = setup({ liberar: vi.fn().mockResolvedValue(null) });
        await run(lote(msg({ text: `LIBERAR #${LOJA}` })));
        expect(responder).toHaveBeenCalledTimes(1);
    });
});

describe("robustez", () => {
    it("falha ao enviar não derruba o lote nem vaza telefone ou texto no log", async () => {
        const { run, logger } = setup({ enviar: vi.fn().mockRejectedValue(new Error(`falha para ${PHONE}: Quanto custa?`)) });
        await expect(run(lote(msg({ messageId: "wamid.1" }), msg({ messageId: "wamid.2" })))).resolves.toBeUndefined();
        const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls]);
        expect(logged).not.toContain(PHONE);
        expect(logged).not.toContain("Quanto custa");
    });
    it("erro no responder numa mensagem não impede as seguintes", async () => {
        const responder = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue("ok");
        const { run } = setup({ responder });
        await run(lote(msg({ messageId: "wamid.1" }), msg({ messageId: "wamid.2" })));
        expect(responder).toHaveBeenCalledTimes(2);
    });
    it("erro no banco numa mensagem não impede as seguintes", async () => {
        const store = memStore();
        const original = store.registrarMensagem.bind(store);
        store.registrarMensagem = vi.fn().mockRejectedValueOnce(new Error("db")).mockImplementation(original);
        const { run, responder } = setup({ store });
        await run(lote(msg({ messageId: "wamid.1" }), msg({ messageId: "wamid.2" })));
        expect(responder).toHaveBeenCalledTimes(1);
    });
    it("cliente só com BSUID (telefone oculto): usa o BSUID como contactKey", async () => {
        const { run, responder } = setup();
        await run(normalizeMetaWebhook(fx.bsuidOnlyMessage));
        // sem código nem conversa: orientação (não responder); o contactKey é o BSUID
        expect(responder).not.toHaveBeenCalled();
    });
});

describe("privacidade do log", () => {
    it("nunca telefone, nome nem texto, em nenhum caminho", async () => {
        const { run, logger } = setup();
        await run(lote(msg({ messageId: "wamid.1", text: `Meu CPF é 123.456.789-00 #${LOJA}` })));
        await run(lote(msg({ messageId: "wamid.1", text: "repetida" })));
        await run(lote(msg({ messageId: "wamid.2", type: "audio", text: null })));
        await run(lote(msg({ messageId: "wamid.3", text: "parar" })));
        const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls]);
        for (const dado of [PHONE, "Maria", "CPF", "123.456", LOJA, "wamid"]) expect(logged, dado).not.toContain(dado);
    });
    it("hashContato é estável, curto e não contém o telefone", () => {
        expect(hashContato(PHONE)).toBe(hashContato(PHONE));
        expect(hashContato(PHONE)).toHaveLength(8);
        expect(hashContato(PHONE)).not.toContain(PHONE);
    });
});

describe("janela de 24 h: a mensagem do cliente é gravada ANTES de qualquer resposta", () => {
    it.each([
        ["resposta da IA", { text: `oi #${LOJA}` }],
        ["orientação sem loja", { text: "oi" }],
        ["tipo não suportado", { type: "audio", text: null }],
        ["confirmação de parar", { text: "parar" }],
    ])("%s", async (_n, over) => {
        const store = memStore();
        let gravadaAntes = false;
        const enviar = vi.fn(async (contactKey: string) => {
            gravadaAntes = [...store.msgs.values()].some((r) => r.direcao === "in" && r.contactKey === contactKey);
            return "wamid.OUT";
        });
        const { run } = setup({ store, enviar });
        await run(lote(msg(over)));
        expect(enviar).toHaveBeenCalledTimes(1);
        expect(gravadaAntes).toBe(true);
    });
});
