import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));
vi.mock("@/lib/mailer", () => ({ sendMail: vi.fn() }));

import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { _zerarEnviados, marcarEnviadaPeloCrm } from "@/modules/agente-salao/enviados";
import { bindBotPedidos, type EntradaBot } from "./entrada";

const SESSAO = "sessao-loja";
const BARRACA = "cd4ac833-86de-4429-83d9-8b24c7ab23db";
const CLIENTE = "5561999990001@s.whatsapp.net";

function montar(over: { barraca?: string | null } = {}) {
    const handlers: Record<string, (e: any) => Promise<void>> = {};
    const sock = { ev: { on: (n: string, h: (e: any) => Promise<void>) => { handlers[n] = h; } } } as unknown as WASocket;
    const tratar = vi.fn(async (_e: EntradaBot) => undefined);
    const humanoAssumiu = vi.fn();
    bindBotPedidos(sock, SESSAO, { barracaDaSessao: async () => (over.barraca === undefined ? BARRACA : over.barraca), tratar, humanoAssumiu });
    const msg = (texto: string, o: { jid?: string; fromMe?: boolean; id?: string; alt?: string; idadeS?: number } = {}): WAMessage => ({
        key: { remoteJid: o.jid ?? CLIENTE, fromMe: o.fromMe ?? false, id: o.id ?? `M${Math.random()}`, remoteJidAlt: o.alt },
        messageTimestamp: Math.floor(Date.now() / 1000) - (o.idadeS ?? 0),
        pushName: "Ana",
        message: { conversation: texto },
    }) as unknown as WAMessage;
    const emitir = (m: WAMessage, type = "notify") => handlers["messages.upsert"]({ messages: [m], type });
    return { tratar, humanoAssumiu, msg, emitir };
}

beforeEach(() => {
    _zerarEnviados();
    delete process.env.WHATSAPP_CLOUD_SESSION_ID;
});

describe("ponte do Baileys para o bot de pedidos", () => {
    it("texto de cliente vira EntradaBot com telefone só em dígitos", async () => {
        const t = montar();
        const m = t.msg("oi", { id: "ABC" });
        await t.emitir(m);
        expect(t.tratar).toHaveBeenCalledTimes(1);
        const e = t.tratar.mock.calls[0][0];
        expect(e).toMatchObject({ sessionId: SESSAO, barracaId: BARRACA, jid: CLIENTE, contactKey: "5561999990001", nome: "Ana", texto: "oi", messageId: "ABC" });
        expect(typeof e.timestamp).toBe("number");
    });

    it("usa o remoteJidAlt quando o chat vem como @lid", async () => {
        const t = montar();
        await t.emitir(t.msg("oi", { jid: "123456@lid", alt: "5561999990002@s.whatsapp.net" }));
        expect(t.tratar.mock.calls[0][0].contactKey).toBe("5561999990002");
    });

    it("ignora grupo, status, @lid sem telefone, mensagem antiga, tipo diferente de notify e texto vazio", async () => {
        const t = montar();
        await t.emitir(t.msg("oi", { jid: "120363000000000000@g.us" }));
        await t.emitir(t.msg("oi", { jid: "status@broadcast" }));
        await t.emitir(t.msg("oi", { jid: "123456@lid" }));
        await t.emitir(t.msg("oi", { idadeS: 3600 }));
        await t.emitir(t.msg("oi"), "append");
        await t.emitir(t.msg(""));
        expect(t.tratar).not.toHaveBeenCalled();
    });

    it("ignora mensagem enviada pelo CRM e mensagens de sessão sem barraca", async () => {
        const t = montar();
        marcarEnviadaPeloCrm("MEU");
        await t.emitir(t.msg("oi", { fromMe: true, id: "MEU" }));
        expect(t.tratar).not.toHaveBeenCalled();
        expect(t.humanoAssumiu).not.toHaveBeenCalled();

        const sem = montar({ barraca: null });
        await sem.emitir(sem.msg("oi"));
        await sem.emitir(sem.msg("oi", { fromMe: true }));
        expect(sem.tratar).not.toHaveBeenCalled();
        expect(sem.humanoAssumiu).not.toHaveBeenCalled();
    });

    it("fromMe que não saiu do CRM pausa o bot para aquele contato", async () => {
        const t = montar();
        await t.emitir(t.msg("já te respondo", { fromMe: true, id: "HUMANO" }));
        expect(t.humanoAssumiu).toHaveBeenCalledWith(SESSAO, "5561999990001");
        expect(t.tratar).not.toHaveBeenCalled();
    });

    it("não liga em sessão da Cloud API", () => {
        process.env.WHATSAPP_CLOUD_SESSION_ID = SESSAO;
        const on = vi.fn();
        bindBotPedidos({ ev: { on } } as unknown as WASocket, SESSAO, { barracaDaSessao: async () => BARRACA });
        expect(on).not.toHaveBeenCalled();
    });

    it("erro em tratar não derruba o laço", async () => {
        const t = montar();
        t.tratar.mockRejectedValueOnce(new Error("x"));
        await expect(t.emitir(t.msg("oi"))).resolves.toBeUndefined();
    });
});
