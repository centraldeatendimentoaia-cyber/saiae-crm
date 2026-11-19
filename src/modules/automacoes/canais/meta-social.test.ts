import { describe, expect, it, vi } from "vitest";
import { executarRun } from "../executor";
import { criarDeps, criarStoreMemoria } from "../testes-util";
import type { Definicao } from "../tipos";
import { enviarTextoSocial, ErroEnvioSocial, type EnvioSocial } from "./meta-social";

const AGORA = Date.UTC(2030, 5, 1, 12);
const resposta = (status: number, corpo: unknown) => vi.fn(async () => new Response(JSON.stringify(corpo), { status }));
const base = (extra: Partial<EnvioSocial> = {}): EnvioSocial => ({
    canal: "instagram", pageId: "PG1", token: "TOKEN-SECRETO", texto: "Olá!", destinatarioId: "U1",
    janelaAteMs: AGORA + 3_600_000, agoraMs: AGORA, ...extra,
});
const chamada = (f: ReturnType<typeof vi.fn>) => {
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    return { url, headers: init.headers as Record<string, string>, corpo: JSON.parse(init.body as string) };
};
const falha = async (i: EnvioSocial) => (await enviarTextoSocial(i).then(() => null, (e) => e)) as ErroEnvioSocial;

describe("enviarTextoSocial", () => {
    it("Instagram DM: POST /{page}/messages com recipient.id e token no cabeçalho", async () => {
        const f = resposta(200, { recipient_id: "U1", message_id: "m1" });
        expect(await enviarTextoSocial(base({ fetchImpl: f }))).toEqual({ messageId: "m1", privada: false });
        const c = chamada(f);
        expect(c.url).toMatch(/^https:\/\/graph\.facebook\.com\/v[\d.]+\/PG1\/messages$/);
        expect(c.url).not.toContain("TOKEN");
        expect(c.headers.Authorization).toBe("Bearer TOKEN-SECRETO");
        expect(c.corpo).toEqual({ recipient: { id: "U1" }, message: { text: "Olá!" } });
    });
    it("Messenger DM: messaging_type RESPONSE", async () => {
        const f = resposta(200, { recipient_id: "U1", message_id: "m2" });
        await enviarTextoSocial(base({ canal: "messenger", fetchImpl: f }));
        expect(chamada(f).corpo).toEqual({ recipient: { id: "U1" }, messaging_type: "RESPONSE", message: { text: "Olá!" } });
    });
    it("resposta privada a comentário: recipient.comment_id", async () => {
        const f = resposta(200, { recipient_id: "U1", message_id: "m3" });
        const r = await enviarTextoSocial(base({ comentarioId: "C1", janelaAteMs: AGORA + 86_400_000, fetchImpl: f }));
        expect(r.privada).toBe(true);
        expect(chamada(f).corpo.recipient).toEqual({ comment_id: "C1" });
    });
    it("fora da janela de 24 h: erro de política e nada vai à Meta", async () => {
        const f = resposta(200, { message_id: "x" });
        const e = await falha(base({ janelaAteMs: AGORA - 1, fetchImpl: f }));
        expect(e).toMatchObject({ classe: "policy", motivo: "fora_da_janela" });
        expect(f).not.toHaveBeenCalled();
    });
    it("token ausente: permanente, pede reconexão, sem chamar a Meta", async () => {
        const f = resposta(200, {});
        expect(await falha(base({ token: undefined, fetchImpl: f }))).toMatchObject({ classe: "permanent", motivo: "sem_token", reconectar: true });
        expect(f).not.toHaveBeenCalled();
    });
    it("token expirado (código 190): permanente, reconectar, sem vazar token nem corpo bruto", async () => {
        const e = await falha(base({ fetchImpl: resposta(400, { error: { code: 190, message: "Token TOKEN-SECRETO de Maria 5561999990001 expirou" } }) }));
        expect(e).toMatchObject({ classe: "permanent", motivo: "permissao_ou_token", reconectar: true });
        expect(e.message).not.toMatch(/TOKEN-SECRETO|Maria|5561999990001/);
    });
    it("4xx genérico é permanente; 5xx sem código é transitório; limite de taxa é transitório", async () => {
        expect(await falha(base({ fetchImpl: resposta(400, { error: { code: 100, message: "x" } }) }))).toMatchObject({ classe: "permanent" });
        expect(await falha(base({ fetchImpl: resposta(503, {}) }))).toMatchObject({ classe: "transient", motivo: "indisponivel" });
        expect(await falha(base({ fetchImpl: resposta(400, { error: { code: 613, message: "x" } }) }))).toMatchObject({ classe: "transient", motivo: "limite_de_taxa" });
    });
    it("fora da janela segundo a Meta (code 10, subcode 2534022) é política", async () => {
        expect(await falha(base({ fetchImpl: resposta(400, { error: { code: 10, error_subcode: 2534022, message: "x" } }) }))).toMatchObject({ classe: "policy", motivo: "fora_da_janela" });
    });
    it("falha de rede e resposta sem id: resultado desconhecido (nunca reenviar)", async () => {
        expect(await falha(base({ fetchImpl: vi.fn(async () => { throw new Error("ECONNRESET"); }) }))).toMatchObject({ classe: "unknown" });
        expect(await falha(base({ fetchImpl: resposta(200, {}) }))).toMatchObject({ classe: "unknown" });
    });
    it("texto acima do limite do Instagram (1000 bytes) é recusado antes de enviar", async () => {
        const f = resposta(200, {});
        expect(await falha(base({ texto: "é".repeat(501), fetchImpl: f }))).toMatchObject({ classe: "permanent", motivo: "texto_invalido" });
        expect(f).not.toHaveBeenCalled();
    });
});

describe("executor com canal social", () => {
    const def = (no: Definicao["nodes"][string]): Record<string, Definicao> => ({ v1: { schemaVersion: 1, start: "a", nodes: { a: no } } });
    const rodar = async (d: Record<string, Definicao>, social?: unknown) => {
        const agora = { t: AGORA };
        const m = criarStoreMemoria(d);
        m.criar("r1", "v1", new Date(AGORA), { contactKey: "instagram:U1", context: { vars: { conta_externa_id: "IG1", janela_ate_ms: AGORA + 1000 }, tentativas: {} } });
        const deps = criarDeps({ agora });
        if (social) deps.social = social as never;
        const r = await executarRun("r1", m.store, deps);
        return { r, run: m.runs.get("r1")!, deps };
    };
    const social = () => ({ contaAtiva: vi.fn(async () => true), optedOut: vi.fn(async () => false), enviarTexto: vi.fn(async () => ({ messageId: "m1", privada: false })) });

    it("nó texto envia pelo provedor social, não pelo WhatsApp", async () => {
        const s = social();
        const { r, deps } = await rodar(def({ type: "texto", text: "oi" }), s);
        expect(r).toBe("completed");
        expect(s.enviarTexto).toHaveBeenCalledWith(expect.objectContaining({ contactKey: "instagram:U1", texto: "oi" }));
        expect(deps.sendText).not.toHaveBeenCalled();
    });
    it("nó template em canal social falha com erro claro e não envia", async () => {
        const s = social();
        const { r, run } = await rodar(def({ type: "template", name: "t", languageCode: "pt_BR" }), s);
        expect(r).toBe("failed");
        expect(run.lastError).toMatch(/template é só WhatsApp/);
        expect(s.enviarTexto).not.toHaveBeenCalled();
    });
    it("sem provedor social configurado: falha permanente", async () => {
        const { r, run } = await rodar(def({ type: "texto", text: "oi" }));
        expect(r).toBe("failed");
        expect(run.lastError).toMatch(/sem provedor/);
    });
    it("erro de política do provedor encerra sem retentativa; opt-out cancela antes de enviar", async () => {
        const s = social();
        s.enviarTexto.mockRejectedValue(new ErroEnvioSocial("policy", "fora_da_janela", "fora da janela"));
        expect((await rodar(def({ type: "texto", text: "oi" }), s)).r).toBe("failed");
        const o = social();
        o.optedOut.mockResolvedValue(true);
        const x = await rodar(def({ type: "texto", text: "oi" }), o);
        expect(x.r).toBe("cancelled");
        expect(o.enviarTexto).not.toHaveBeenCalled();
    });
    it("erro transitório agenda nova tentativa", async () => {
        const s = social();
        s.enviarTexto.mockRejectedValue(new ErroEnvioSocial("transient", "indisponivel", "Meta indisponível"));
        expect((await rodar(def({ type: "texto", text: "oi" }), s)).r).toBe("waiting");
    });
});
