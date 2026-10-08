import { describe, expect, it, vi } from "vitest";
import crypto from "crypto";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import { confirmarNaComanda, criarConfirmador, criarPedidoConfirmacao, MAX_PEDIDOS_CONFIRMACAO_DIA, MSG_NUMERO_CONFIRMADO } from "./confirmar-dono";

const T0 = new Date("2026-10-08T12:00:00Z");
const TEL = "5561988887777";
const SEGREDO = "segredo-ia-com-mais-de-16-chars";
const URL_CONF = "https://x.supabase.co/functions/v1/ia-dono-confirmar";

describe("pedido de confirmação (Comanda → CRM)", () => {
    const montar = (total = 1, enviar: () => Promise<unknown> = async () => ({})) => {
        const enviarTemplate = vi.fn(enviar);
        const contar = vi.fn(async () => total);
        const logger = { info: vi.fn(), warn: vi.fn() };
        return { enviarTemplate, contar, logger, pedir: criarPedidoConfirmacao({ enviarTemplate, contar, now: () => T0, logger }) };
    };
    it("envia o template ia_chamar_dono ao telefone informado, pedindo CONFIRMAR #CODIGO", async () => {
        const m = montar();
        expect(await m.pedir("ABC234", TEL)).toEqual({ enviado: true });
        expect(m.enviarTemplate).toHaveBeenCalledWith(TEL, expect.objectContaining({ name: "ia_chamar_dono", languageCode: "pt_BR" }));
        const p = (m.enviarTemplate.mock.calls[0] as unknown as [string, { bodyParameters: string[] }])[1].bodyParameters;
        expect(p).toHaveLength(4);
        expect(p[1]).toContain("CONFIRMAR #ABC234");
        expect(p[2]).toBe("nenhum");
        expect(p[3]).toBe("ABC234");
        expect(m.contar).toHaveBeenCalledWith("ABC234", "confirmar:2026-10-08");
    });
    it("aceita telefone nacional (a Cloud API recebe com 55)", async () => {
        const m = montar();
        await m.pedir("ABC234", "61988887777");
        expect((m.enviarTemplate.mock.calls[0] as unknown as [string])[0]).toBe(TEL);
    });
    it.each(["", "123", "BR.abc"])("telefone inválido (%j): sem_whatsapp e nada enviado", async (t) => {
        const m = montar();
        expect(await m.pedir("ABC234", t)).toEqual({ enviado: false, motivo: "sem_whatsapp" });
        expect(m.enviarTemplate).not.toHaveBeenCalled();
    });
    it("até 3 por loja por dia; o 4º não envia", async () => {
        expect(await montar(MAX_PEDIDOS_CONFIRMACAO_DIA).pedir("ABC234", TEL)).toEqual({ enviado: true });
        const m = montar(MAX_PEDIDOS_CONFIRMACAO_DIA + 1);
        expect(await m.pedir("ABC234", TEL)).toEqual({ enviado: false, motivo: "limite" });
        expect(m.enviarTemplate).not.toHaveBeenCalled();
    });
    it("falha da contagem não envia sem teto", async () => {
        const enviarTemplate = vi.fn(async () => ({}));
        const pedir = criarPedidoConfirmacao({ enviarTemplate, contar: async () => { throw new Error("db"); }, now: () => T0, logger: { info: vi.fn(), warn: vi.fn() } });
        expect(await pedir("ABC234", TEL)).toEqual({ enviado: false, motivo: "falha_envio" });
        expect(enviarTemplate).not.toHaveBeenCalled();
    });
    it("falha no envio: falha_envio e o log não vaza telefone", async () => {
        const m = montar(1, async () => { throw new Error(`falhou ${TEL}`); });
        expect(await m.pedir("ABC234", TEL)).toEqual({ enviado: false, motivo: "falha_envio" });
        expect(JSON.stringify([m.logger.info.mock.calls, m.logger.warn.mock.calls])).not.toContain(TEL);
    });
});

describe("template próprio de confirmação (IA_TEMPLATE_CONFIRMAR)", () => {
    const montar = (template?: string) => {
        const enviarTemplate = vi.fn(async () => ({}));
        return { enviarTemplate, pedir: criarPedidoConfirmacao({ enviarTemplate, contar: async () => 1, template, now: () => T0, logger: { info: vi.fn(), warn: vi.fn() } }) };
    };
    it("com a env: usa o template novo com {{1}} nome da loja e {{2}} código", async () => {
        const m = montar("ia_confirmar_responsavel");
        expect(await m.pedir("ABC234", TEL, "Açaí do  Zé")).toEqual({ enviado: true });
        expect(m.enviarTemplate).toHaveBeenCalledWith(TEL, { name: "ia_confirmar_responsavel", languageCode: "pt_BR", bodyParameters: ["Açaí do Zé", "ABC234"] });
    });
    it("sem o nome da loja usa 'sua loja'; nome longo é cortado e quebras de linha somem", async () => {
        const m = montar("ia_confirmar_responsavel");
        await m.pedir("ABC234", TEL);
        await m.pedir("ABC234", TEL, "A\nB".repeat(50));
        const [a, b] = m.enviarTemplate.mock.calls.map((c) => (c as unknown as [string, { bodyParameters: string[] }])[1].bodyParameters[0]);
        expect(a).toBe("sua loja");
        expect(b.length).toBeLessThanOrEqual(60);
        expect(b).not.toMatch(/[\r\n]/);
    });
    it("sem a env: continua no ia_chamar_dono (4 parâmetros)", async () => {
        const m = montar();
        await m.pedir("ABC234", TEL, "Loja X");
        const t = (m.enviarTemplate.mock.calls[0] as unknown as [string, { name: string; bodyParameters: string[] }])[1];
        expect(t.name).toBe("ia_chamar_dono");
        expect(t.bodyParameters).toHaveLength(4);
        expect(t.bodyParameters[0]).toBe("Loja X");
    });
});

describe("CONFIRMAR #CODIGO (dono → CRM → Comanda)", () => {
    const montar = (ok: boolean) => {
        const confirmar = vi.fn(async () => ok);
        return { confirmar, c: criarConfirmador({ confirmar, logger: { info: vi.fn() } }) };
    };
    it.each(["CONFIRMAR #abc234", "confirmar ABC234", "  Confirmar #ABC234  "])("%j: pergunta à Comanda com o remetente e responde confirmado", async (t) => {
        const m = montar(true);
        expect(await m.c(t, "5561988887777")).toBe(MSG_NUMERO_CONFIRMADO);
        expect(m.confirmar).toHaveBeenCalledWith("ABC234", TEL);
    });
    it("a Comanda diz que o número é outro: null (nada revelado, segue como cliente comum)", async () => {
        expect(await montar(false).c("CONFIRMAR #ABC234", TEL)).toBeNull();
    });
    it.each(["oi, posso confirmar o pedido?", "CONFIRMAR", "CONFIRMAR #AB", "CONFIRMAR #ABC234 agora"])("texto %j não é pedido de confirmação", async (t) => {
        const m = montar(true);
        expect(await m.c(t, TEL)).toBeNull();
        expect(m.confirmar).not.toHaveBeenCalled();
    });
    it("remetente sem telefone válido (BSUID): null e não consulta a Comanda", async () => {
        const m = montar(true);
        expect(await m.c("CONFIRMAR #ABC234", "BR.123")).toBeNull();
        expect(m.confirmar).not.toHaveBeenCalled();
    });
});

describe("confirmarNaComanda (CRM → edge function)", () => {
    const env = { COMANDA_IA_SEGREDO: SEGREDO, COMANDA_IA_DONO_CONFIRMAR_URL: URL_CONF };
    const resp = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    const logger = { warn: vi.fn() };

    it("POST assinado como o ia-contexto, com o corpo exato", async () => {
        const fetchMock = vi.fn().mockResolvedValue(resp(200, { confirmado: true }));
        expect(await confirmarNaComanda("ABC234", TEL, { fetch: fetchMock as unknown as typeof fetch, env, now: () => T0.getTime(), logger })).toBe(true);
        const [url, init] = fetchMock.mock.calls[0];
        const corpo = '{"codigo_loja":"ABC234","telefone":"5561988887777"}';
        const ts = String(Math.floor(T0.getTime() / 1000));
        expect(url).toBe(URL_CONF);
        expect(init.body).toBe(corpo);
        expect(init.headers["X-Saiae-Timestamp"]).toBe(ts);
        expect(init.headers["X-Saiae-Signature"]).toBe("sha256=" + crypto.createHmac("sha256", SEGREDO).update(`${ts}.${corpo}`).digest("hex"));
    });
    it("usa o primeiro segredo da lista", async () => {
        const fetchMock = vi.fn().mockResolvedValue(resp(200, { confirmado: true }));
        await confirmarNaComanda("ABC234", TEL, { fetch: fetchMock as unknown as typeof fetch, env: { ...env, COMANDA_IA_SEGREDO: `${SEGREDO}, outro-segredo-antigo-16` }, now: () => T0.getTime(), logger });
        expect(fetchMock.mock.calls[0][1].headers["X-Saiae-Signature"]).toMatch(/^sha256=/);
    });
    it.each([
        ["confirmado:false", resp(200, { confirmado: false, motivo: "numero_diferente" })],
        ["corpo estranho", resp(200, { ok: true })],
        ["HTTP 401", resp(401, {})],
        ["HTTP 503", resp(503, {})],
    ])("%s: false", async (_n, r) => {
        expect(await confirmarNaComanda("ABC234", TEL, { fetch: vi.fn().mockResolvedValue(r) as unknown as typeof fetch, env, logger })).toBe(false);
    });
    it("rede/timeout: false; sem env: false sem chamar", async () => {
        expect(await confirmarNaComanda("ABC234", TEL, { fetch: vi.fn().mockRejectedValue(new Error(`x ${TEL}`)) as unknown as typeof fetch, env, logger })).toBe(false);
        const f = vi.fn();
        expect(await confirmarNaComanda("ABC234", TEL, { fetch: f as unknown as typeof fetch, env: {}, logger })).toBe(false);
        expect(f).not.toHaveBeenCalled();
        expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(TEL);
    });
});
