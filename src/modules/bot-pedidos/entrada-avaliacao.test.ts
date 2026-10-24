import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ avaliacao: vi.fn(), bot: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));
vi.mock("@/lib/mailer", () => ({ sendMail: vi.fn() }));
vi.mock("@/modules/disparos/avaliacao", () => ({ tratarRespostaAvaliacao: h.avaliacao }));
vi.mock("./motor", () => ({ tratar: h.bot, humanoAssumiu: vi.fn() }));

import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { _zerarEnviados } from "@/modules/agente-salao/enviados";
import { bindBotPedidos } from "./entrada";

// Usa o `tratar` padrão (sem injetar): a resposta de avaliação precisa passar ANTES do bot de pedidos.
function emitir(texto: string) {
    const handlers: Record<string, (e: any) => Promise<void>> = {};
    const sock = { ev: { on: (n: string, f: (e: any) => Promise<void>) => { handlers[n] = f; } } } as unknown as WASocket;
    bindBotPedidos(sock, "sessao-loja", { barracaDaSessao: async () => "cd4ac833-86de-4429-83d9-8b24c7ab23db" });
    const msg = { key: { remoteJid: "5561999990001@s.whatsapp.net", fromMe: false, id: `M${Math.random()}` }, messageTimestamp: Math.floor(Date.now() / 1000), pushName: "Ana", message: { conversation: texto } } as unknown as WAMessage;
    return handlers["messages.upsert"]({ messages: [msg], type: "notify" });
}

beforeEach(() => {
    _zerarEnviados();
    h.avaliacao.mockReset();
    h.bot.mockReset().mockResolvedValue(undefined);
});

describe("avaliação antes do bot", () => {
    it("nota tratada pela avaliação: o bot não é chamado", async () => {
        h.avaliacao.mockResolvedValue(true);
        await emitir("5");
        expect(h.avaliacao).toHaveBeenCalledWith({ sessionId: "sessao-loja", jid: "5561999990001@s.whatsapp.net", contactKey: "5561999990001", texto: "5" });
        expect(h.bot).not.toHaveBeenCalled();
    });
    it("não é avaliação: segue para o bot", async () => {
        h.avaliacao.mockResolvedValue(false);
        await emitir("quero um pastel");
        expect(h.bot).toHaveBeenCalledTimes(1);
    });
});
