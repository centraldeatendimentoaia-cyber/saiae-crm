import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ conta: vi.fn(), optout: vi.fn(), enviar: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { socialAccount: { findFirst: m.conta }, optOut: { findUnique: m.optout } } }));
vi.mock("@/modules/social/crypto", () => ({ decryptToken: (t: string) => { if (t === "ruim") throw new Error("formato"); return `claro-${t}`; } }));
vi.mock("./meta-social", async (orig) => ({ ...(await orig<typeof import("./meta-social")>()), enviarTextoSocial: m.enviar }));

import { depsSocialReais } from "./social-prisma";

const vars = { conta_externa_id: "IG1", janela_ate_ms: 5000 };
beforeEach(() => { vi.clearAllMocks(); m.conta.mockResolvedValue({ id: "acc1", pageId: "PG1", accessToken: "cifrado" }); m.enviar.mockResolvedValue({ messageId: "m", privada: false }); });

describe("depsSocialReais", () => {
    it("DM: usa a Página da conta do usuário, token descriptografado e o remetente do contactKey", async () => {
        await depsSocialReais.enviarTexto({ userId: "u1", contactKey: "instagram:U9", texto: "oi", vars, agoraMs: 1 });
        expect(m.conta).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u1", provider: "instagram", externalId: "IG1" } }));
        expect(m.enviar).toHaveBeenCalledWith(expect.objectContaining({ canal: "instagram", pageId: "PG1", token: "claro-cifrado", destinatarioId: "U9", comentarioId: undefined, janelaAteMs: 5000 }));
    });
    it("Messenger consulta provider facebook; comentário vira resposta privada, uma só vez", async () => {
        await depsSocialReais.enviarTexto({ userId: "u1", contactKey: "messenger:U9", texto: "oi", vars: { ...vars, comentario_id: "C1" }, agoraMs: 1 });
        expect(m.conta).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ provider: "facebook" }) }));
        expect(m.enviar).toHaveBeenCalledWith(expect.objectContaining({ comentarioId: "C1" }));
        await expect(depsSocialReais.enviarTexto({ userId: "u1", contactKey: "messenger:U9", texto: "2", vars: { ...vars, comentario_id: "C1", resposta_privada_enviada: true }, agoraMs: 1 }))
            .rejects.toMatchObject({ classe: "policy", motivo: "resposta_privada_ja_usada" });
    });
    it("token que não descriptografa vira token ausente; conta inexistente falha sem enviar", async () => {
        m.conta.mockResolvedValue({ id: "acc1", pageId: "PG1", accessToken: "ruim" });
        await depsSocialReais.enviarTexto({ userId: "u1", contactKey: "instagram:U9", texto: "oi", vars, agoraMs: 1 });
        expect(m.enviar).toHaveBeenCalledWith(expect.objectContaining({ token: undefined }));
        m.conta.mockResolvedValue(null);
        await expect(depsSocialReais.enviarTexto({ userId: "u1", contactKey: "instagram:U9", texto: "oi", vars, agoraMs: 1 })).rejects.toMatchObject({ motivo: "sem_token" });
        expect(await depsSocialReais.contaAtiva("u1", "instagram:U9", vars)).toBe(false);
    });
    it("opt-out social usa a chave social:<accountId> + id do remetente", async () => {
        m.optout.mockResolvedValue({ id: "o" });
        expect(await depsSocialReais.optedOut("u1", "instagram:U9", vars)).toBe(true);
        expect(m.optout).toHaveBeenCalledWith(expect.objectContaining({ where: { sessionId_phoneKey: { sessionId: "social:acc1", phoneKey: "U9" } } }));
    });
});
