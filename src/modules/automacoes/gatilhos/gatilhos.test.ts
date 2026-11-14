import { describe, expect, it, vi } from "vitest";
import { diagnosticarGatilhos, PERMISSOES_DISPONIVEIS, type AmbienteGatilhos } from "./catalogo";
import { normalizarWebhookSocial } from "./eventos";
import { classificarErroCanal, dmDentroDaJanela, respostaPrivadaDentroDaJanela } from "./canal";
import { processarEventoSocial, type DepsRoteador, type FluxoComGatilho } from "./roteador";

const AGORA = Date.UTC(2030, 5, 1, 12);
const TODAS = ["instagram_manage_messages", "instagram_manage_comments", "pages_messaging", "pages_read_user_content", "pages_manage_metadata"];
const ligado = (extra: Record<string, string> = {}): AmbienteGatilhos => ({
    env: { AUTOMACOES_GATILHO_IG_DM: "true", AUTOMACOES_GATILHO_IG_COMENTARIO: "true", AUTOMACOES_GATILHO_MSGR_DM: "true", SOCIAL_META_APP_SECRET: "s", SOCIAL_WEBHOOK_VERIFY_TOKEN: "t", ...extra },
    permissoes: [...PERMISSOES_DISPONIVEIS, ...TODAS], provedorDeCanal: true,
});

const dmPayload = (mid: string, texto: string, over: { conta?: string; de?: string; ts?: number; echo?: boolean; object?: string } = {}) => ({
    object: over.object ?? "instagram",
    entry: [{ id: over.conta ?? "IG1", messaging: [{ sender: { id: over.de ?? "U1" }, recipient: { id: over.conta ?? "IG1" }, timestamp: over.ts ?? AGORA - 1000, message: { mid, text: texto, is_echo: over.echo } }] }],
});
const comentarioPayload = (id: string, texto: string, over: { conta?: string; ts?: number; post?: string } = {}) => ({
    object: "instagram",
    entry: [{ id: over.conta ?? "IG1", changes: [{ field: "comments", value: { id, text: texto, from: { id: "U9" }, media: { id: over.post ?? "P1" }, created_time: over.ts ?? AGORA - 1000 } }] }],
});

function montar(fluxos: Record<string, FluxoComGatilho[]>, over: Partial<DepsRoteador> = {}) {
    const vistos = new Set<string>();
    const optouts = new Set<string>();
    const iniciar = vi.fn(async () => ({ ok: true }));
    const deps: DepsRoteador = {
        ambiente: ligado(), agoraMs: () => AGORA,
        contasPorExterno: async (canal, ext) => (ext === "IG1" ? [{ accountId: "acc1", userId: "u1" }] : ext === "IG2" ? [{ accountId: "acc2", userId: "u2" }] : []),
        fluxosDaConta: async (userId) => fluxos[userId] ?? [],
        reservar: async (k) => (vistos.has(k) ? false : (vistos.add(k), true)),
        optedOut: async (a, r) => optouts.has(`${a}:${r}`),
        registrarOptOut: async (a, r) => { optouts.add(`${a}:${r}`); },
        iniciar, ...over,
    };
    return { deps, iniciar, optouts };
}
const fluxoPalavra = (flowId: string, accountId: string, palavras: string[]): FluxoComGatilho => ({ flowId, trigger: { tipo: "dm_palavra_chave", canal: "instagram", accountId, palavras } });
const fluxoComentario = (flowId: string, accountId: string, extra: object = {}): FluxoComGatilho => ({ flowId, trigger: { tipo: "comentario_post", canal: "instagram", accountId, ...extra } });

describe("diagnóstico", () => {
  it("padrão: todos desligados por flag, com motivo", () => {
        const d = diagnosticarGatilhos({ env: {}, permissoes: PERMISSOES_DISPONIVEIS, provedorDeCanal: false });
        expect(d.length).toBe(6);
        for (const g of d) { expect(g.estado).toBe("desabilitado_flag"); expect(g.motivo).toContain(g.flag); }
    });
    it("flag ligada mas permissão da Meta ausente (situação real hoje): bloqueado e lista o que falta", () => {
        const d = diagnosticarGatilhos({ env: { AUTOMACOES_GATILHO_IG_DM: "true", AUTOMACOES_GATILHO_IG_COMENTARIO: "true", AUTOMACOES_GATILHO_MSGR_DM: "true" }, permissoes: PERMISSOES_DISPONIVEIS, provedorDeCanal: true });
        const ig = d.find((g) => g.id === "instagram_dm_palavra_chave")!;
        expect(ig.estado).toBe("bloqueado_permissao");
        expect(ig.permissoesFaltando).toContain("instagram_manage_messages");
        expect(PERMISSOES_DISPONIVEIS).not.toContain("instagram_manage_messages");
        expect(d.every((g) => g.estado !== "habilitado")).toBe(true);
    });
    it("com tudo presente mas sem provedor de envio ou sem webhook: não habilita", () => {
        const a = ligado();
        expect(diagnosticarGatilhos({ ...a, provedorDeCanal: false }).every((g) => g.estado !== "habilitado")).toBe(true);
        const b = diagnosticarGatilhos({ ...a, env: { ...a.env, SOCIAL_META_APP_SECRET: "" } });
        expect(b.find((g) => g.id === "instagram_dm_qualquer")!.estado).toBe("webhook_nao_configurado");
    });
    it("tudo presente: habilitado só os que têm flag", () => {
        const d = diagnosticarGatilhos(ligado());
        expect(d.find((g) => g.id === "instagram_dm_palavra_chave")!.estado).toBe("habilitado");
        expect(d.find((g) => g.id === "messenger_comentario_post")!.estado).toBe("desabilitado_flag");
    });
});

describe("normalização do webhook", () => {
    it("DM e comentário válidos", () => {
        expect(normalizarWebhookSocial(dmPayload("m1", "oi"))).toMatchObject([{ tipo: "dm", eventoId: "dm:m1", remetenteId: "U1", contaExternaId: "IG1" }]);
        expect(normalizarWebhookSocial(comentarioPayload("c1", "eu quero"))).toMatchObject([{ tipo: "comentario", comentarioId: "c1", postId: "P1", autorId: "U9" }]);
    });
    it("ignora eco, mensagem da própria conta, sem texto, objeto desconhecido e lixo", () => {
        expect(normalizarWebhookSocial(dmPayload("m2", "oi", { echo: true }))).toEqual([]);
        expect(normalizarWebhookSocial(dmPayload("m3", "oi", { de: "IG1" }))).toEqual([]);
        expect(normalizarWebhookSocial(dmPayload("m4", "oi", { object: "whatsapp_business_account" }))).toEqual([]);
        for (const lixo of [null, 1, "x", [], {}, { object: "instagram", entry: "x" }, { object: "instagram", entry: [null, 1, {}] }]) expect(normalizarWebhookSocial(lixo)).toEqual([]);
    });
    it("Página: comentário via feed e DM como messenger", () => {
        const fb = { object: "page", entry: [{ id: "PG1", changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: "c7", post_id: "PG1_9", from: { id: "U3" }, message: "quero" } }] }] };
        expect(normalizarWebhookSocial(fb)).toMatchObject([{ canal: "messenger", comentarioId: "c7" }]);
        expect(normalizarWebhookSocial(dmPayload("m5", "oi", { object: "page" }))[0].canal).toBe("messenger");
    });
});

describe("gatilhos: DM por palavra-chave e qualquer DM", () => {
    it("palavra-chave (sem acento/caixa, palavra inteira) inicia o fluxo com contexto", async () => {
        const { deps, iniciar } = montar({ u1: [fluxoPalavra("f1", "acc1", ["Promoção"])] });
        const [ev] = normalizarWebhookSocial(dmPayload("m1", "Oi, quero a PROMOCAO!"));
        expect(await processarEventoSocial(ev, deps)).toEqual([{ resultado: "iniciado", flowId: "f1", userId: "u1" }]);
        expect(iniciar).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", flowId: "f1", contactKey: "instagram:U1", dedupeKey: "dm:m1" }));
    });
    it("palavra dentro de outra palavra não casa; sem palavra não inicia", async () => {
        const { deps, iniciar } = montar({ u1: [fluxoPalavra("f1", "acc1", ["sim"])] });
        const [ev] = normalizarWebhookSocial(dmPayload("m1", "simplesmente"));
        expect((await processarEventoSocial(ev, deps))[0]).toEqual({ resultado: "ignorado", motivo: "sem_fluxo_correspondente" });
        expect(iniciar).not.toHaveBeenCalled();
    });
    it("qualquer DM inicia", async () => {
        const { deps } = montar({ u1: [{ flowId: "f2", trigger: { tipo: "dm_qualquer", canal: "instagram", accountId: "acc1" } }] });
        const [ev] = normalizarWebhookSocial(dmPayload("m1", "qualquer coisa"));
        expect((await processarEventoSocial(ev, deps))[0].resultado).toBe("iniciado");
    });
});

describe("gatilho de comentário", () => {
    it("preserva comentário/post/autor no contexto e responde uma vez por comentário", async () => {
        const { deps, iniciar } = montar({ u1: [fluxoComentario("f1", "acc1", { palavras: ["eu quero"], postId: "P1" }), fluxoComentario("f2", "acc1")] });
        const [ev] = normalizarWebhookSocial(comentarioPayload("c1", "Eu quero!"));
        const r = await processarEventoSocial(ev, deps);
        expect(r).toEqual([{ resultado: "iniciado", flowId: "f1", userId: "u1" }]); // f2 também casa, mas só uma resposta privada
        const vars = (iniciar.mock.calls[0] as unknown as [{ variaveis: Record<string, unknown> }])[0].variaveis;
        expect(vars).toMatchObject({ comentario_id: "c1", post_id: "P1", autor_id: "U9", canal: "instagram", gatilho: "comentario_post" });
        expect(vars.janela_ate_ms).toBe(AGORA - 1000 + 7 * 24 * 3_600_000);
    });
    it("post diferente do configurado não dispara", async () => {
        const { deps, iniciar } = montar({ u1: [fluxoComentario("f1", "acc1", { postId: "OUTRO" })] });
        const [ev] = normalizarWebhookSocial(comentarioPayload("c1", "oi"));
        expect((await processarEventoSocial(ev, deps))[0]).toMatchObject({ motivo: "sem_fluxo_correspondente" });
        expect(iniciar).not.toHaveBeenCalled();
    });
    it("comentário fora da janela de 7 dias não dispara", async () => {
        const { deps, iniciar } = montar({ u1: [fluxoComentario("f1", "acc1")] });
        const [ev] = normalizarWebhookSocial(comentarioPayload("c1", "oi", { ts: AGORA - 8 * 24 * 3_600_000 }));
        expect((await processarEventoSocial(ev, deps))[0]).toEqual({ resultado: "ignorado", motivo: "fora_da_janela" });
        expect(iniciar).not.toHaveBeenCalled();
    });
});

describe("deduplicação, isolamento, janela, consentimento, flag", () => {
    it("o mesmo evento entregue duas vezes inicia uma vez", async () => {
        const { deps, iniciar } = montar({ u1: [fluxoPalavra("f1", "acc1", ["oi"])] });
        const [ev] = normalizarWebhookSocial(dmPayload("m1", "oi"));
        await processarEventoSocial(ev, deps);
        expect((await processarEventoSocial(ev, deps))[0]).toEqual({ resultado: "ignorado", motivo: "evento_duplicado" });
        expect(iniciar).toHaveBeenCalledTimes(1);
    });
    it("evento de uma conta só dispara fluxos do dono dela; gatilho apontando para outra conta é ignorado", async () => {
        const { deps, iniciar } = montar({ u1: [fluxoPalavra("f1", "acc1", ["oi"]), fluxoPalavra("fX", "acc2", ["oi"])], u2: [fluxoPalavra("f2", "acc2", ["oi"])] });
        const [ev] = normalizarWebhookSocial(dmPayload("m1", "oi", { conta: "IG2" }));
        const r = await processarEventoSocial(ev, deps);
        expect(r).toEqual([{ resultado: "iniciado", flowId: "f2", userId: "u2" }]);
        expect(iniciar.mock.calls.map((c) => (c as unknown as [{ userId: string }])[0].userId)).toEqual(["u2"]);
        const [ev2] = normalizarWebhookSocial(dmPayload("m2", "oi", { conta: "IGX" }));
        expect((await processarEventoSocial(ev2, deps))[0]).toEqual({ resultado: "ignorado", motivo: "conta_desconhecida" });
    });
    it("DM fora da janela de 24 h não dispara", async () => {
        const { deps, iniciar } = montar({ u1: [fluxoPalavra("f1", "acc1", ["oi"])] });
        const [ev] = normalizarWebhookSocial(dmPayload("m1", "oi", { ts: AGORA - 25 * 3_600_000 }));
        expect((await processarEventoSocial(ev, deps))[0]).toEqual({ resultado: "ignorado", motivo: "fora_da_janela" });
        expect(iniciar).not.toHaveBeenCalled();
        expect(dmDentroDaJanela(AGORA - 23 * 3_600_000, AGORA)).toBe(true);
        expect(respostaPrivadaDentroDaJanela(AGORA - 6 * 24 * 3_600_000, AGORA)).toBe(true);
    });
    it("SAIR registra opt-out e não dispara; depois disso nenhuma DM dispara para esse remetente", async () => {
        const { deps, iniciar, optouts } = montar({ u1: [fluxoPalavra("f1", "acc1", ["oi", "sair"])] });
        const [sair] = normalizarWebhookSocial(dmPayload("m1", "SAIR"));
        expect((await processarEventoSocial(sair, deps))[0]).toEqual({ resultado: "ignorado", motivo: "optout_registrado" });
        expect(optouts.has("acc1:U1")).toBe(true);
        const [oi] = normalizarWebhookSocial(dmPayload("m2", "oi"));
        expect((await processarEventoSocial(oi, deps))[0]).toEqual({ resultado: "ignorado", motivo: "optout" });
        expect(iniciar).not.toHaveBeenCalled();
    });
    it("flag desligada, permissão ausente ou sem provedor: não dispara nem consulta banco", async () => {
        const base = montar({ u1: [fluxoPalavra("f1", "acc1", ["oi"])] });
        const contas = vi.fn(base.deps.contasPorExterno);
        const [ev] = normalizarWebhookSocial(dmPayload("m1", "oi"));
        for (const ambiente of [{ ...ligado(), env: {} }, { ...ligado(), permissoes: PERMISSOES_DISPONIVEIS }, { ...ligado(), provedorDeCanal: false }]) {
            const r = await processarEventoSocial(ev, { ...base.deps, ambiente, contasPorExterno: contas });
            expect(r).toEqual([{ resultado: "ignorado", motivo: "gatilho_desabilitado" }]);
        }
        expect(contas).not.toHaveBeenCalled();
        expect(base.iniciar).not.toHaveBeenCalled();
    });
});

describe("erros do canal", () => {
    it("classifica com send-failure", () => {
        expect(classificarErroCanal({ code: 10, subcode: 2018278 })).toMatchObject({ classe: "policy", motivo: "fora_da_janela" });
        expect(classificarErroCanal({ code: 613 })).toMatchObject({ classe: "transient", motivo: "limite_de_taxa" });
        expect(classificarErroCanal({ code: 190 })).toMatchObject({ classe: "permanent", reconectar: true });
        expect(classificarErroCanal({ code: 200 })).toMatchObject({ classe: "permanent", reconectar: true });
        expect(classificarErroCanal({ code: 551 })).toMatchObject({ classe: "permanent", motivo: "usuario_indisponivel" });
        expect(classificarErroCanal({ code: 368 })).toMatchObject({ classe: "policy", motivo: "bloqueado" });
        expect(classificarErroCanal({ code: 2 })).toMatchObject({ classe: "unknown" });
        expect(classificarErroCanal(null).classe).toBe("unknown");
    });
});
