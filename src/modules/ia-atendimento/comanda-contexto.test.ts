import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { assinar, buscarContexto, INATIVA, CACHE_TTL_MS, TIMEOUT_MS, type ContextoDeps } from "./comanda-contexto";
import { BoundedTtlMap } from "@/modules/integracao/comanda/state";

const SEGREDO = "segredo-de-plataforma-com-16-chars+";
const URL_CTX = "https://projeto.supabase.co/functions/v1/ia-contexto";
const LOJA = "K7P2QX";
const TEL = "5561999990001";
const AGORA = 1_760_000_000_000;

const contextoAtivo = (over: Record<string, unknown> = {}) => ({
    ativa: true,
    loja: {
        nome: "Açaí do Didi", endereco: "Av. Paulista, 1000", aberta_agora: true,
        horarios: [{ dia: 1, aberto: true, abre: "11:00", fecha: "22:00" }],
        modos: ["retirada", "entrega"], pagamentos: ["pix_online", "dinheiro"],
        taxa_entrega: { habilitada: true, padrao_centavos: 500, bairro_nao_listado: "taxa_padrao", bairros: [{ bairro: "Centro", taxa_centavos: 300 }] },
        link_cardapio: "https://app.saiae.com.br/didi/cardapio",
    },
    cardapio: {
        truncado: false,
        itens: [{ nome: "Açaí 300ml", descricao: "com banana", categoria: "Sobremesas", preco_centavos: 1600, esgotado: false,
                  adicionais: [{ grupo: "Tamanho", tipo: "variacao", obrigatorio: true, opcoes: [{ nome: "Grande", preco_centavos: 2200 }] }] }],
    },
    cliente: { primeiro_nome: "Maria", ultimos_pedidos: [{ itens: ["Açaí 300ml"] }] },
    ia: { texto_livre: "Aceitamos Pix", whatsapp_dono: "5561988887777", plano_limite_conversas: 200 },
    ...over,
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
let logger: { warn: ReturnType<typeof vi.fn> };
let deps: Partial<ContextoDeps>;

beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(ok(contextoAtivo()));
    logger = { warn: vi.fn() };
    deps = {
        fetch: fetchMock as unknown as typeof fetch,
        env: { COMANDA_IA_SEGREDO: SEGREDO, COMANDA_IA_URL: URL_CTX },
        now: () => AGORA,
        logger,
        cache: new BoundedTtlMap<never>(100, CACHE_TTL_MS) as ContextoDeps["cache"],
    };
});

describe("requisição assinada", () => {
    it("POST com o corpo exato, cabeçalhos do contrato e HMAC de timestamp + '.' + corpo", async () => {
        await buscarContexto(LOJA, TEL, deps);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(URL_CTX);
        expect(init.method).toBe("POST");
        const corpo = '{"codigo_loja":"K7P2QX","telefone":"5561999990001"}';
        expect(init.body).toBe(corpo);
        const ts = String(Math.floor(AGORA / 1000));
        expect(init.headers).toEqual({
            "Content-Type": "application/json",
            "X-Saiae-Timestamp": ts,
            "X-Saiae-Signature": "sha256=" + crypto.createHmac("sha256", SEGREDO).update(`${ts}.${corpo}`).digest("hex"),
        });
    });
    it("a assinatura muda se o corpo, o timestamp ou o segredo mudam", () => {
        const base = assinar(SEGREDO, "1", "{}");
        expect(assinar(SEGREDO, "2", "{}")).not.toBe(base);
        expect(assinar(SEGREDO, "1", "{ }")).not.toBe(base);
        expect(assinar("outro-segredo-qualquer-longo", "1", "{}")).not.toBe(base);
        expect(base).toMatch(/^sha256=[0-9a-f]{64}$/);
    });
    it("o telefone vai só com dígitos (máscara e + são removidos)", async () => {
        await buscarContexto(LOJA, "+55 (61) 99999-0001", deps);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).telefone).toBe(TEL);
    });
    it("aceita telefone nacional de 10 ou 11 dígitos (a Comanda normaliza)", async () => {
        await buscarContexto(LOJA, "61999990001", deps);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).telefone).toBe("61999990001");
    });
});

describe("resposta", () => {
    it("contexto ativo válido passa com todos os campos", async () => {
        const r = await buscarContexto(LOJA, TEL, deps);
        expect(r.ativa).toBe(true);
        if (r.ativa) {
            expect(r.loja.nome).toBe("Açaí do Didi");
            expect(r.cardapio.itens[0].adicionais[0]).toMatchObject({ tipo: "variacao", obrigatorio: true });
            expect(r.cliente).toEqual({ primeiro_nome: "Maria", ultimos_pedidos: [{ itens: ["Açaí 300ml"] }] });
            expect(r.loja.taxa_entrega.bairro_nao_listado).toBe("taxa_padrao");
        }
    });
    it("cliente null (sem perfil confirmado) é mantido: a IA trata como cliente novo", async () => {
        fetchMock.mockResolvedValue(ok(contextoAtivo({ cliente: null })));
        const r = await buscarContexto(LOJA, TEL, deps);
        expect(r.ativa && r.cliente).toBeNull();
    });
    it("campo a MAIS no contexto é aceito (contrato aditivo)", async () => {
        const c = contextoAtivo() as Record<string, unknown>;
        c.campo_futuro = { x: 1 };
        (c.loja as Record<string, unknown>).outro = "y";
        expect((await buscarContexto(LOJA, TEL, deps)).ativa).toBe(true);
    });
    it("campos aditivos ausentes (tipo do grupo, bairro_nao_listado) usam o padrão", async () => {
        const c = contextoAtivo() as { loja: { taxa_entrega: Record<string, unknown> }; cardapio: { itens: { adicionais: Record<string, unknown>[] }[] } };
        delete c.loja.taxa_entrega.bairro_nao_listado;
        delete c.cardapio.itens[0].adicionais[0].tipo;
        fetchMock.mockResolvedValue(ok(c));
        const r = await buscarContexto(LOJA, TEL, deps);
        expect(r.ativa && r.loja.taxa_entrega.bairro_nao_listado).toBe("taxa_padrao");
        expect(r.ativa && r.cardapio.itens[0].adicionais[0].tipo).toBe("adicional");
    });
    it("ativa:false passa direto", async () => {
        fetchMock.mockResolvedValue(ok({ ativa: false }));
        expect(await buscarContexto(LOJA, TEL, deps)).toEqual({ ativa: false });
    });
    it("texto livre e nomes são cortados (limite de tamanho, defesa de prompt)", async () => {
        const c = contextoAtivo({ ia: { texto_livre: "x".repeat(5000), whatsapp_dono: null, plano_limite_conversas: null } });
        fetchMock.mockResolvedValue(ok(c));
        const r = await buscarContexto(LOJA, TEL, deps);
        expect(r.ativa && r.ia.texto_livre?.length).toBe(2000);
    });
    it.each([
        ["sem o campo ativa", { loja: {} }],
        ["ativa verdadeira mas sem loja", { ativa: true }],
        ["preço como texto", contextoAtivo({ cardapio: { truncado: false, itens: [{ nome: "x", descricao: null, categoria: "c", preco_centavos: "16", esgotado: false, adicionais: [] }] } })],
        ["preço negativo", contextoAtivo({ cardapio: { truncado: false, itens: [{ nome: "x", descricao: null, categoria: "c", preco_centavos: -1, esgotado: false, adicionais: [] }] } })],
        ["preço com centavos fracionados", contextoAtivo({ cardapio: { truncado: false, itens: [{ nome: "x", descricao: null, categoria: "c", preco_centavos: 1.5, esgotado: false, adicionais: [] }] } })],
        ["link do cardápio que não é URL", contextoAtivo({ loja: { ...contextoAtivo().loja, link_cardapio: "não é url" } })],
        ["mais de 200 itens", contextoAtivo({ cardapio: { truncado: false, itens: Array(201).fill({ nome: "x", descricao: null, categoria: "c", preco_centavos: 1, esgotado: false, adicionais: [] }) } })],
        ["array no lugar de objeto", []],
        ["null", null],
        ["texto", "ok"],
    ])("resposta fora do contrato (%s) vira ativa:false e é registrada", async (_n, body) => {
        fetchMock.mockResolvedValue(ok(body));
        expect(await buscarContexto(LOJA, TEL, deps)).toEqual(INATIVA);
        expect(logger.warn).toHaveBeenCalledWith("IaContexto", "resposta da Comanda fora do contrato");
    });
    it("corpo que não é JSON vira ativa:false", async () => {
        fetchMock.mockResolvedValue(new Response("<html>erro</html>", { status: 200 }));
        expect(await buscarContexto(LOJA, TEL, deps)).toEqual(INATIVA);
    });
});

describe("falhas viram ativa:false (a IA fica calada em vez de inventar)", () => {
    it.each([400, 401, 413, 500, 503])("HTTP %i", async (status) => {
        fetchMock.mockResolvedValue(new Response("{}", { status }));
        expect(await buscarContexto(LOJA, TEL, deps)).toEqual(INATIVA);
        expect(logger.warn).toHaveBeenCalledWith("IaContexto", `Comanda respondeu HTTP ${status}`);
    });
    it("erro de rede", async () => {
        fetchMock.mockRejectedValue(new TypeError("fetch failed"));
        expect(await buscarContexto(LOJA, TEL, deps)).toEqual(INATIVA);
    });
    it("tempo esgotado: aborta a requisição depois de 8 s", async () => {
        vi.useFakeTimers();
        try {
            fetchMock.mockImplementation((_u: string, init: RequestInit) => new Promise((_res, rej) => {
                init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
            }));
            const p = buscarContexto(LOJA, TEL, deps);
            await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
            expect(await p).toEqual(INATIVA);
            expect(logger.warn).toHaveBeenCalledWith("IaContexto", "tempo esgotado falando com a Comanda");
        } finally {
            vi.useRealTimers();
        }
    });
    it("nunca lança, qualquer que seja o erro", async () => {
        fetchMock.mockImplementation(() => { throw new Error("síncrono"); });
        await expect(buscarContexto(LOJA, TEL, deps)).resolves.toEqual(INATIVA);
    });
});

describe("configuração e entradas inválidas (nem chama a Comanda)", () => {
    it.each([
        ["sem segredo", { COMANDA_IA_URL: URL_CTX }],
        ["sem URL", { COMANDA_IA_SEGREDO: SEGREDO }],
        ["segredo vazio", { COMANDA_IA_SEGREDO: "  ", COMANDA_IA_URL: URL_CTX }],
        ["nada configurado", {}],
    ])("%s", async (_n, env) => {
        expect(await buscarContexto(LOJA, TEL, { ...deps, env })).toEqual(INATIVA);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each(["k7p2qx", "K7P2Q", "K7P2QXY", "K7P-QX", "", "K7P2Q "])("código de loja inválido %j", async (codigo) => {
        expect(await buscarContexto(codigo, TEL, deps)).toEqual(INATIVA);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each(["", "123", "BR.13491208655302741918", "abc61999990001", "55619999900011111", "999990001"])("telefone inválido ou BSUID %j: chama SEM telefone e nunca identifica o cliente", async (tel) => {
        const r = await buscarContexto(LOJA, tel, deps);
        expect(r.ativa).toBe(true);
        expect(r.ativa && r.cliente).toBeNull(); // mesmo que a Comanda devolvesse um cliente
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ codigo_loja: LOJA });
    });
    it("anônimo não vaza para quem tem telefone (chaves de cache diferentes)", async () => {
        await buscarContexto(LOJA, "BR.123", deps);
        const b = await buscarContexto(LOJA, TEL, deps);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(b.ativa && b.cliente).not.toBeNull();
    });
    it("Comanda recusa a chamada sem telefone: IA fica calada", async () => {
        fetchMock.mockResolvedValue(new Response("{}", { status: 422 }));
        expect(await buscarContexto(LOJA, "BR.123", deps)).toEqual(INATIVA);
    });
});

describe("cache de 60 s por loja e telefone", () => {
    it("a segunda busca igual não chama a Comanda", async () => {
        await buscarContexto(LOJA, TEL, deps);
        await buscarContexto(LOJA, TEL, deps);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it("o cache NÃO vaza entre telefones nem entre lojas", async () => {
        fetchMock.mockResolvedValueOnce(ok(contextoAtivo({ cliente: { primeiro_nome: "Maria", ultimos_pedidos: [] } })));
        fetchMock.mockResolvedValueOnce(ok(contextoAtivo({ cliente: null })));
        const a = await buscarContexto(LOJA, TEL, deps);
        const b = await buscarContexto(LOJA, "5561888880002", deps);
        expect(a.ativa && a.cliente?.primeiro_nome).toBe("Maria");
        expect(b.ativa && b.cliente).toBeNull(); // o nome da Maria NUNCA aparece para outro telefone
        await buscarContexto("ABCD23", TEL, deps);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    it("a mesma pessoa com e sem máscara usa a mesma entrada do cache", async () => {
        await buscarContexto(LOJA, TEL, deps);
        await buscarContexto(LOJA, "+55 (61) 99999-0001", deps);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it("falhas NÃO ficam em cache (podem ser passageiras)", async () => {
        fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
        expect(await buscarContexto(LOJA, TEL, deps)).toEqual(INATIVA);
        expect((await buscarContexto(LOJA, TEL, deps)).ativa).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it("expira depois de 60 s", async () => {
        let t = AGORA;
        const cache = new BoundedTtlMap<never>(100, CACHE_TTL_MS, () => t) as ContextoDeps["cache"];
        await buscarContexto(LOJA, TEL, { ...deps, cache });
        t += CACHE_TTL_MS + 1;
        await buscarContexto(LOJA, TEL, { ...deps, cache });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe("privacidade", () => {
    it("nenhum log traz telefone, corpo, segredo ou conteúdo da resposta, em nenhum caminho", async () => {
        fetchMock.mockResolvedValueOnce(new Response(`{"erro":"falha ${TEL}"}`, { status: 500 }));
        await buscarContexto(LOJA, TEL, deps);
        fetchMock.mockRejectedValueOnce(new Error(`falha com ${TEL} e ${SEGREDO}`));
        await buscarContexto(LOJA, "5561888880002", deps);
        fetchMock.mockResolvedValueOnce(ok({ ativa: true, loja: { nome: "Maria Secreta" } }));
        await buscarContexto("ABCD23", TEL, deps);
        await buscarContexto(LOJA, "BR.1349120865", deps);
        const logged = JSON.stringify(logger.warn.mock.calls);
        for (const dado of [TEL, "5561888880002", SEGREDO, "Secreta", "falha com"]) expect(logged, dado).not.toContain(dado);
    });
});
