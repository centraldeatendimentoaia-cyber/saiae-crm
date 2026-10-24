import crypto from "crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { BoundedTtlMap } from "@/modules/integracao/comanda/state";
import { avaliacaoConfig, chamarSaiae, type Cardapio, type DepsSaiae } from "./saiae";

const SEGREDO = "segredo-de-plataforma-1234";
const BARRACA = "cd4ac833-86de-4429-83d9-8b24c7ab23db";
const ENV = { SAIAE_INTEGRACAO_V1_URL: "https://x.supabase.co/functions/v1/integracao-v1", COMANDA_WHATSAPP_SEGREDO: SEGREDO };
const CARDAPIO = {
    ok: true,
    loja: { nome: "Jmal", link_cardapio: "https://app.saiae.com.br/jmal/cardapio", aberta_agora: true, modos: ["retirada"], pagamentos: { na_entrega: true, pix: false }, whatsapp_dono: null, bot_habilitado: true },
    itens: [{ item_id: "i1", nome: "Pastel", grupos: [] }],
};

const resp = (corpo: unknown, status = 200) => ({ ok: status < 400, status, json: async () => corpo }) as Response;
const deps = (f: unknown, env: Record<string, string> = ENV): Partial<DepsSaiae> => ({
    fetch: f as typeof fetch,
    env,
    now: () => 1_800_000_000_000,
    logger: { warn: vi.fn() },
    cache: new BoundedTtlMap<Cardapio>(10, 60_000),
});

describe("chamarSaiae", () => {
    it("assina timestamp.corpo com HMAC e manda barraca_id e acao no corpo", async () => {
        const f = vi.fn(async (..._a: unknown[]) => resp(CARDAPIO));
        await chamarSaiae("cardapio", BARRACA, {}, deps(f));
        const [, init] = f.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
        const esperado = "sha256=" + crypto.createHmac("sha256", SEGREDO).update(`${init.headers["X-Saiae-Timestamp"]}.${init.body}`).digest("hex");
        expect(init.headers["X-Saiae-Signature"]).toBe(esperado);
        expect(JSON.parse(init.body)).toEqual({ barraca_id: BARRACA, acao: "cardapio" });
    });

    it("guarda o cardápio por 60 s", async () => {
        const f = vi.fn(async () => resp(CARDAPIO));
        const d = deps(f);
        await chamarSaiae("cardapio", BARRACA, {}, d);
        await chamarSaiae("cardapio", BARRACA, {}, d);
        expect(f).toHaveBeenCalledTimes(1);
    });

    it("nunca lança: sem URL, HTTP de erro, rede e resposta fora do contrato viram ok:false", async () => {
        expect(await chamarSaiae("pedido", BARRACA, {}, deps(vi.fn(), {}))).toEqual({ ok: false, codigo: "nao_configurado" });
        expect(await chamarSaiae("pedido", BARRACA, {}, deps(async () => resp({}, 500)))).toMatchObject({ ok: false, codigo: "indisponivel" });
        expect(await chamarSaiae("pedido", BARRACA, {}, deps(async () => { throw new Error("rede"); }))).toMatchObject({ ok: false, codigo: "indisponivel" });
        expect(await chamarSaiae("pedido", BARRACA, {}, deps(async () => resp({ lixo: 1 })))).toMatchObject({ ok: false, codigo: "resposta_invalida" });
        expect(await chamarSaiae("cardapio", BARRACA, {}, deps(async () => resp({ ok: false, codigo: "bot_desligado" })))).toEqual({ ok: false, codigo: "bot_desligado" });
    });

    it("erro de negócio passa adiante com o código", async () => {
        const r = await chamarSaiae("pix", BARRACA, {}, deps(async () => resp({ ok: false, codigo: "perfil_obrigatorio", mensagem: "m" })));
        expect(r).toMatchObject({ ok: false, codigo: "perfil_obrigatorio" });
    });

    it("não loga corpo nem telefone", async () => {
        const d = deps(async () => resp({}, 500));
        await chamarSaiae("pedido", BARRACA, { cliente_telefone: "5561999990001" }, d);
        expect(JSON.stringify((d.logger!.warn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("5561999990001");
    });
    it("corpo que não vira JSON não lança: devolve ok:false", async () => {
        const circular: Record<string, unknown> = {};
        circular.a = circular;
        const r = await chamarSaiae("pedido", BARRACA, circular, deps(vi.fn()));
        expect(r).toMatchObject({ ok: false });
    });
});

describe("avaliacaoConfig", () => {
    const AVALIACAO = { ativo: true, texto: null, whatsapp_dono: "5561999990001", barraca_nome: "Jmal" };
    it("chama a ação avaliacao_config assinada e devolve a configuração", async () => {
        const f = vi.fn(async (..._a: unknown[]) => resp({ ok: true, avaliacao: AVALIACAO }));
        expect(await avaliacaoConfig(BARRACA, deps(f))).toEqual(AVALIACAO);
        const [, init] = f.mock.calls[0] as [string, { body: string }];
        expect(JSON.parse(init.body)).toEqual({ barraca_id: BARRACA, acao: "avaliacao_config" });
    });
    it("null em falha de rede, HTTP de erro, recusa ou formato fora do contrato", async () => {
        expect(await avaliacaoConfig(BARRACA, deps(vi.fn(async () => { throw new Error("rede"); })))).toBeNull();
        expect(await avaliacaoConfig(BARRACA, deps(vi.fn(async () => resp({}, 500))))).toBeNull();
        expect(await avaliacaoConfig(BARRACA, deps(vi.fn(async () => resp({ ok: false, codigo: "x" }))))).toBeNull();
        expect(await avaliacaoConfig(BARRACA, deps(vi.fn(async () => resp({ ok: true, avaliacao: { ativo: "sim" } }))))).toBeNull();
    });
    it("null sem URL configurada", async () => {
        expect(await avaliacaoConfig(BARRACA, deps(vi.fn(), {}))).toBeNull();
    });
});
