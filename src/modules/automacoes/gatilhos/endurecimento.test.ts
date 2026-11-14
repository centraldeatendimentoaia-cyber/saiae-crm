import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
    const linhas = new Set<string>();
    return {
        linhas,
        create: vi.fn(async ({ data }: { data: { key: string } }) => {
            await Promise.resolve(); // cede o turno: chamadas simultâneas disputam a mesma chave
            if (linhas.has(data.key)) throw Object.assign(new Error("unique"), { code: "P2002" });
            linhas.add(data.key);
            return { id: "x" };
        }),
        conta: vi.fn(),
    };
});
vi.mock("@/lib/prisma", () => ({ prisma: { automationTriggerEvent: { create: h.create }, socialAccount: { findFirst: h.conta } } }));

import { normalizarWebhookSocial } from "./eventos";
import { reservarNoBanco } from "./real";
import { processarEventoSocial, type DepsRoteador } from "./roteador";
import { validarTrigger } from "./validacao";
import { PERMISSOES_DISPONIVEIS } from "./catalogo";
import { definicaoParaGrafo, grafoParaDefinicao } from "../editor/grafo";
import { validarDefinicao } from "../validador";

beforeEach(() => { h.linhas.clear(); vi.clearAllMocks(); });

describe("reserva atômica no banco", () => {
    it("corrida: reservas simultâneas da mesma chave, só uma vence", async () => {
        const r = await Promise.all([reservarNoBanco("evento:c1"), reservarNoBanco("evento:c1"), reservarNoBanco("evento:c1")]);
        expect(r.filter(Boolean)).toHaveLength(1);
    });
    it("reinício: com cache de memória vazio, a linha do banco ainda barra a repetição (P2002)", async () => {
        h.linhas.add("evento:reinicio"); // gravada por um processo anterior
        expect(await reservarNoBanco("evento:reinicio")).toBe(false);
        expect(h.create).toHaveBeenCalledTimes(1);
        expect(await reservarNoBanco("evento:reinicio")).toBe(false); // agora vem do cache, sem novo acesso
        expect(h.create).toHaveBeenCalledTimes(1);
    });
    it("erro de banco que não é P2002 propaga e não marca a chave como vista", async () => {
        h.create.mockRejectedValueOnce(new Error("conexão"));
        await expect(reservarNoBanco("evento:falha")).rejects.toThrow("conexão");
        expect(await reservarNoBanco("evento:falha")).toBe(true);
    });
});

describe("validarTrigger", () => {
    const ok = { tipo: "dm_palavra_chave", canal: "instagram", accountId: "acc1", palavras: ["oi"] };
    it("sem trigger não valida nada", async () => { expect(await validarTrigger("u1", { nodes: {} })).toEqual([]); });
    it("aceita gatilho válido de conta do próprio usuário (confere userId e provedor)", async () => {
        h.conta.mockResolvedValue({ id: "acc1" });
        expect(await validarTrigger("u1", { trigger: ok })).toEqual([]);
        expect(h.conta).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "acc1", userId: "u1", provider: "instagram" } }));
    });
    it("recusa conta de outro usuário", async () => {
        h.conta.mockResolvedValue(null);
        expect((await validarTrigger("u1", { trigger: ok })).join()).toContain("conta social");
    });
    it.each([
        ["tipo fora do enum", { ...ok, tipo: "x" }],
        ["canal fora do enum", { ...ok, canal: "whatsapp" }],
        ["accountId não string", { ...ok, accountId: 5 }],
        ["mais de 20 palavras", { ...ok, palavras: Array.from({ length: 21 }, () => "a") }],
        ["palavra com mais de 100 caracteres", { ...ok, palavras: ["a".repeat(101)] }],
        ["palavras não array", { ...ok, palavras: "oi" }],
        ["postId longo demais", { ...ok, postId: "p".repeat(101) }],
        ["campo extra", { ...ok, extra: 1 }],
    ])("recusa %s sem consultar o banco", async (_n, t) => {
        expect((await validarTrigger("u1", { trigger: t })).length).toBeGreaterThan(0);
        expect(h.conta).not.toHaveBeenCalled();
    });
});

describe("roteador: isolamento por fluxo", () => {
    const AGORA = Date.UTC(2030, 5, 1, 12);
    it("fluxo malformado ou que falha ao iniciar não impede os outros", async () => {
        const iniciar = vi.fn(async ({ flowId }: { flowId: string }) => { if (flowId === "quebra") throw new Error("boom"); return { ok: true }; });
        const deps: DepsRoteador = {
            ambiente: { env: { AUTOMACOES_GATILHO_IG_DM: "true", SOCIAL_META_APP_SECRET: "s", SOCIAL_WEBHOOK_VERIFY_TOKEN: "t" }, permissoes: [...PERMISSOES_DISPONIVEIS, "instagram_manage_messages", "pages_messaging"], provedorDeCanal: true },
            agoraMs: () => AGORA,
            contasPorExterno: async () => [{ accountId: "acc1", userId: "u1" }],
            fluxosDaConta: async () => [
                { flowId: "ruim", trigger: { tipo: "dm_palavra_chave", canal: "instagram", accountId: "acc1", palavras: "oi" as unknown as string[] } },
                { flowId: "nulo", trigger: null as never },
                { flowId: "quebra", trigger: { tipo: "dm_qualquer", canal: "instagram", accountId: "acc1" } },
                { flowId: "bom", trigger: { tipo: "dm_qualquer", canal: "instagram", accountId: "acc1" } },
            ],
            reservar: async () => true, optedOut: async () => false, registrarOptOut: async () => undefined, iniciar,
        };
        const ev = normalizarWebhookSocial({ object: "instagram", entry: [{ id: "IG1", messaging: [{ sender: { id: "U1" }, timestamp: AGORA - 1000, message: { mid: "m", text: "oi" } }] }] })[0];
        const r = await processarEventoSocial(ev, deps);
        expect(r).toContainEqual({ resultado: "iniciado", flowId: "bom", userId: "u1" });
        expect(r).toContainEqual({ resultado: "falhou", flowId: "quebra", motivo: "erro" });
    });
});

describe("created_time do Messenger", () => {
    const com = (t: number) => normalizarWebhookSocial({ object: "page", entry: [{ id: "PG1", changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: "c", from: { id: "U" }, post_id: "p", message: "oi", created_time: t } }] }] })[0].emMs;
    it("segundos Unix viram ms; ms ficam como estão", () => {
        expect(com(1_900_000_000)).toBe(1_900_000_000_000);
        expect(com(1_900_000_000_000)).toBe(1_900_000_000_000);
    });
});

describe("ids de nó perigosos", () => {
    it.each(["__proto__", "constructor", "prototype"])("validador recusa o id %s", (id) => {
        const nodes = {};
        Object.defineProperty(nodes, id, { value: { type: "fim" }, enumerable: true });
        expect(validarDefinicao({ schemaVersion: 1, start: id, nodes }).join()).toContain("id de nó inválido");
    });
    it("grafo: aresta com origem 'constructor' não escreve no protótipo", () => {
        const g = definicaoParaGrafo({ schemaVersion: 1, start: "a", nodes: { a: { type: "fim" } } } as never);
        const d = grafoParaDefinicao({ ...g, edges: [{ id: "e", source: "constructor", target: "a", sourceHandle: "next" }] });
        expect(Object.keys(d.nodes)).toEqual(["a"]);
        expect(({} as Record<string, unknown>).next).toBeUndefined();
    });
});
