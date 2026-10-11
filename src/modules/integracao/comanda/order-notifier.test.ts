import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } })); // evita iniciar o agendador ao importar

import { createOrderNotifier, templateFor, barracaName, normalizeBrPhone, TEMPLATE_LANGUAGE, type NotifierDeps } from "./order-notifier";
import { BoundedTtlMap } from "./state";
import { CloudApiError } from "@/modules/whatsapp/cloud/errors";
import type { ComandaEvent } from "./schema";

const BARRACA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PEDIDO = "11111111-1111-4111-8111-111111111111";

const ev = (type: ComandaEvent["type"], data: Record<string, unknown> = {}, over: Partial<ComandaEvent> = {}): ComandaEvent => ({
    id: crypto.randomUUID(), type, version: 1, occurred_at: "2026-10-08T12:00:00Z", barraca_id: BARRACA, sequence: 1,
    data: { pedido_id: PEDIDO, senha: 42, status: "a_fazer", tipo_atendimento: "retirada", cliente: { nome: "Maria Teste", telefone: "61999990001" }, ...data },
    ...over,
});

function setup(over: Partial<NotifierDeps> = {}) {
    const sendTemplate = vi.fn().mockResolvedValue({ messageId: "wamid.X" });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const deps: Partial<NotifierDeps> = {
        env: { COMANDA_NOTIFY_TEMPLATES: "on", WHATSAPP_CLOUD_SESSION_ID: "pilot", COMANDA_BARRACA_NOMES: JSON.stringify({ [BARRACA]: "Açaí do Didi" }) },
        getProvider: () => ({ name: "cloud-api", sessionId: "pilot", sendTemplate }) as never,
        isOptedOut: vi.fn().mockResolvedValue(false),
        logger,
        sent: new BoundedTtlMap<true>(100, 60_000),
        ...over,
    };
    return { run: createOrderNotifier(deps), sendTemplate, logger, deps };
}

describe("templateFor", () => {
    it.each([
        ["order.created", {}, "pedido_recebido"],
        ["order.status_changed", { status: "a_fazer" }, null], // dispararia também no "Voltar"
        ["order.status_changed", { status: "pronto" }, null],
        ["order.status_changed", { status: "entregue" }, null],
        ["order.ready", { tipo_atendimento: "retirada" }, "pedido_pronto"],
        ["order.ready", { tipo_atendimento: "mesa" }, "pedido_pronto"],
        ["order.ready", { tipo_atendimento: "entrega" }, "pedido_pronto"], // pronto na entrega = pronto para o entregador retirar
        ["order.out_for_delivery", { tipo_atendimento: "entrega", status: "saiu_entrega" }, "pedido_saiu_entrega_v2"],
        ["order.paid", {}, null],
        ["order.cancelled", {}, null],
        ["customer.created", {}, null],
        ["coupon.redeemed", {}, null],
    ] as const)("%s %j → %s", (type, data, expected) => {
        expect(templateFor(ev(type, data))).toBe(expected);
    });
});

describe("desligado por padrão", () => {
    it.each([undefined, "", "off", "true", "1"])("COMANDA_NOTIFY_TEMPLATES=%j: não envia nada", async (v) => {
        const { run, sendTemplate } = setup({ env: { COMANDA_NOTIFY_TEMPLATES: v, WHATSAPP_CLOUD_SESSION_ID: "pilot" } });
        await run(ev("order.created"));
        expect(sendTemplate).not.toHaveBeenCalled();
    });
});

describe("envio", () => {
    it("manda o template certo com nome, senha e barraca, em pt_BR, para o telefone do cliente", async () => {
        const { run, sendTemplate } = setup();
        await run(ev("order.created"));
        expect(sendTemplate).toHaveBeenCalledTimes(1);
        expect(sendTemplate).toHaveBeenCalledWith("5561999990001", {
            name: "pedido_recebido", languageCode: TEMPLATE_LANGUAGE, bodyParameters: ["Maria Teste", "42", "Açaí do Didi"],
        });
    });
    it("usa a sessão Cloud do piloto (a primeira da lista)", async () => {
        const getProvider = vi.fn(() => ({ sendTemplate: vi.fn().mockResolvedValue({}) }) as never);
        const { run } = setup({ getProvider, env: { COMANDA_NOTIFY_TEMPLATES: "on", WHATSAPP_CLOUD_SESSION_ID: " a , b" } });
        await run(ev("order.created"));
        expect(getProvider).toHaveBeenCalledWith("a");
    });
    it("telefone com formatação vira só dígitos", async () => {
        const { run, sendTemplate } = setup();
        await run(ev("order.created", { cliente: { nome: "x", telefone: "+55 (61) 99999-0001" } }));
        expect(sendTemplate.mock.calls[0][0]).toBe("5561999990001");
    });
    it("nome ausente, senha ausente e barraca sem nome configurado têm valor padrão (a Meta recusa parâmetro vazio)", async () => {
        const { run, sendTemplate } = setup({ env: { COMANDA_NOTIFY_TEMPLATES: "on", WHATSAPP_CLOUD_SESSION_ID: "pilot" } });
        await run(ev("order.created", { senha: null, cliente: { nome: null, telefone: "5561999990001" } }));
        expect(sendTemplate.mock.calls[0][1].bodyParameters).toEqual(["cliente", "-", "a loja"]);
    });
    it("parâmetros sem quebra de linha e com tamanho limitado", async () => {
        const { run, sendTemplate } = setup();
        await run(ev("order.created", { cliente: { nome: "Maria\n\n  da   Silva " + "x".repeat(100), telefone: "5561999990001" } }));
        const nome = sendTemplate.mock.calls[0][1].bodyParameters[0];
        expect(nome).not.toMatch(/\n|\s{2}/);
        expect(nome.length).toBeLessThanOrEqual(60);
    });
});

describe("quando NÃO envia", () => {
    it.each([
        ["sem cliente", { cliente: null }],
        ["cliente sem telefone", { cliente: { nome: "Maria" } }],
        ["telefone nulo", { cliente: { nome: "Maria", telefone: null } }],
        ["telefone curto demais", { cliente: { nome: "Maria", telefone: "123" } }],
        ["9 dígitos (sem DDD)", { cliente: { nome: "Maria", telefone: "999990001" } }],
        ["14 dígitos", { cliente: { nome: "Maria", telefone: "55619999900011" } }],
        ["12 dígitos que não começam com 55", { cliente: { nome: "Maria", telefone: "446199990001" } }],
        ["telefone que não é número (ex.: BSUID)", { cliente: { nome: "Maria", telefone: "BR.abcdefghij" } }],
    ])("%s", async (_n, data) => {
        const { run, sendTemplate, logger } = setup();
        await run(ev("order.created", data));
        expect(sendTemplate).not.toHaveBeenCalled();
        expect(logger.info.mock.calls.join()).toContain("telefone ausente ou inválido");
    });
    it("cliente descadastrado: respeita o opt-out", async () => {
        const isOptedOut = vi.fn().mockResolvedValue(true);
        const { run, sendTemplate, logger } = setup({ isOptedOut });
        await run(ev("order.created"));
        expect(isOptedOut).toHaveBeenCalledWith("pilot", "5561999990001@s.whatsapp.net");
        expect(sendTemplate).not.toHaveBeenCalled();
        expect(logger.info.mock.calls.join()).toContain("descadastrado");
    });
    it("falha ao consultar o opt-out: NÃO envia (falha fechada) e não propaga", async () => {
        const { run, sendTemplate } = setup({ isOptedOut: vi.fn().mockRejectedValue(new Error("db fora")) });
        await expect(run(ev("order.created"))).resolves.toBeUndefined();
        expect(sendTemplate).not.toHaveBeenCalled();
    });
    it("Cloud API não configurada (sem sessão listada ou sem credenciais)", async () => {
        const a = setup({ env: { COMANDA_NOTIFY_TEMPLATES: "on" } });
        await a.run(ev("order.created"));
        const b = setup({ getProvider: () => null });
        await b.run(ev("order.created"));
        expect(a.sendTemplate).not.toHaveBeenCalled();
        expect(b.sendTemplate).not.toHaveBeenCalled();
        expect(b.logger.warn.mock.calls.join()).toContain("Cloud API não configurada");
    });
    it("provedor Baileys (sem sendTemplate): não envia", async () => {
        const { run, logger } = setup({ getProvider: () => ({ name: "baileys" }) as never });
        await run(ev("order.created"));
        expect(logger.warn.mock.calls.join()).toContain("Cloud API não configurada");
    });
});

describe("repetição e falhas", () => {
    it("o mesmo template do mesmo pedido não sai duas vezes", async () => {
        const { run, sendTemplate } = setup();
        await run(ev("order.created"));
        await run(ev("order.created", {}, { sequence: 2 }));
        expect(sendTemplate).toHaveBeenCalledTimes(1);
    });
    it("templates diferentes do mesmo pedido saem, cada um uma vez", async () => {
        const { run, sendTemplate } = setup();
        await run(ev("order.created"));
        await run(ev("order.status_changed", { status: "a_fazer" })); // sem gatilho
        await run(ev("order.ready"));
        await run(ev("order.ready"));
        expect(sendTemplate.mock.calls.map((c) => c[1].name)).toEqual(["pedido_recebido", "pedido_pronto"]);
    });
    it("Saiu para entrega: voltar e sair de novo NÃO reenvia o aviso (1 por pedido)", async () => {
        const { run, sendTemplate } = setup();
        await run(ev("order.out_for_delivery", { tipo_atendimento: "entrega", status: "saiu_entrega" }));
        await run(ev("order.out_for_delivery", { tipo_atendimento: "entrega", status: "saiu_entrega" }, { sequence: 5 }));
        expect(sendTemplate.mock.calls.map((c) => c[1].name)).toEqual(["pedido_saiu_entrega_v2"]);
    });
    it("pedidos e barracas diferentes são independentes", async () => {
        const { run, sendTemplate } = setup();
        await run(ev("order.created"));
        await run(ev("order.created", { pedido_id: "22222222-2222-4222-8222-222222222222" }));
        await run(ev("order.created", {}, { barraca_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }));
        expect(sendTemplate).toHaveBeenCalledTimes(3);
    });
    it("falha de envio NÃO propaga, não marca como enviado (nova tentativa pode tentar de novo) e loga só tipo e código", async () => {
        const sendTemplate = vi
            .fn()
            .mockRejectedValueOnce(new CloudApiError("template", "Meta: Template name does not exist com 5561999990001", { code: 132001 }))
            .mockResolvedValue({ messageId: "w" });
        const { run, logger } = setup({ getProvider: () => ({ sendTemplate }) as never });
        await expect(run(ev("order.created"))).resolves.toBeUndefined();
        expect(logger.warn.mock.calls.join()).toContain("pedido_recebido falhou: template codigo=132001");
        await run(ev("order.created"));
        expect(sendTemplate).toHaveBeenCalledTimes(2);
    });
    it("erro que não é da Meta também não propaga", async () => {
        const { run, logger } = setup({ getProvider: () => ({ sendTemplate: vi.fn().mockRejectedValue(new Error("boom")) }) as never });
        await expect(run(ev("order.created"))).resolves.toBeUndefined();
        expect(logger.warn.mock.calls.join()).toContain("erro_inesperado");
    });
});

describe("privacidade do log", () => {
    it("nunca telefone, nome, senha, barraca ou itens, em nenhum caminho", async () => {
        const failing = setup({
            getProvider: () => ({ sendTemplate: vi.fn().mockRejectedValue(new CloudApiError("template", "falha 5561999990001 Maria Teste", { code: 132001, details: "Maria Teste" })) }) as never,
        });
        await failing.run(ev("order.created"));
        const ok = setup();
        await ok.run(ev("order.created"));
        await ok.run(ev("order.created"));
        const optedOut = setup({ isOptedOut: vi.fn().mockResolvedValue(true) });
        await optedOut.run(ev("order.created"));
        const noPhone = setup();
        await noPhone.run(ev("order.created", { cliente: { nome: "Maria Teste" } }));
        const logged = JSON.stringify([failing, ok, optedOut, noPhone].flatMap((s) => [s.logger.info.mock.calls, s.logger.warn.mock.calls]));
        for (const dado of ["5561999990001", "Maria", "Didi", "Yakisoba"]) expect(logged, dado).not.toContain(dado);
        expect(logged).toContain("enviado");
    });
});

describe("barracaName", () => {
    it("lê do env e cai no padrão com env ausente, inválido ou barraca desconhecida", () => {
        expect(barracaName(BARRACA, { COMANDA_BARRACA_NOMES: JSON.stringify({ [BARRACA]: "  Açaí  " }) })).toBe("Açaí");
        expect(barracaName(BARRACA, {})).toBe("a loja");
        expect(barracaName(BARRACA, { COMANDA_BARRACA_NOMES: "{nao json" })).toBe("a loja");
        expect(barracaName("outra", { COMANDA_BARRACA_NOMES: JSON.stringify({ [BARRACA]: "X" }) })).toBe("a loja");
        expect(barracaName(BARRACA, { COMANDA_BARRACA_NOMES: JSON.stringify({ [BARRACA]: 123 }) })).toBe("a loja");
    });
});

describe("barraca_nome vindo no evento", () => {
    it("tem prioridade sobre o env", async () => {
        const { run, sendTemplate } = setup();
        await run(ev("order.created", { barraca_nome: "Barraca do Evento" }));
        expect(sendTemplate.mock.calls[0][1].bodyParameters[2]).toBe("Barraca do Evento");
    });
    it("vazio, só espaços ou não-texto cai no env e depois em 'a loja'", async () => {
        for (const v of ["", "   ", 123, null]) {
            const { run, sendTemplate } = setup();
            await run(ev("order.created", { barraca_nome: v }));
            expect(sendTemplate.mock.calls[0][1].bodyParameters[2], String(v)).toBe("Açaí do Didi");
        }
        const semEnv = setup({ env: { COMANDA_NOTIFY_TEMPLATES: "on", WHATSAPP_CLOUD_SESSION_ID: "pilot" } });
        await semEnv.run(ev("order.created", { barraca_nome: "" }));
        expect(semEnv.sendTemplate.mock.calls[0][1].bodyParameters[2]).toBe("a loja");
    });
    it("sem quebra de linha e com tamanho limitado", async () => {
        const { run, sendTemplate } = setup();
        await run(ev("order.created", { barraca_nome: "Barraca\n\n  do   Didi " + "x".repeat(100) }));
        const nome = sendTemplate.mock.calls[0][1].bodyParameters[2];
        expect(nome).not.toMatch(/\n|\s{2}/);
        expect(nome.length).toBeLessThanOrEqual(60);
    });
    it("o nome da barraca do evento também não vai para o log", async () => {
        const { run, logger } = setup();
        await run(ev("order.created", { barraca_nome: "Barraca Secreta" }));
        expect(JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls])).not.toContain("Secreta");
    });
});

describe("telefone nacional do contrato → E.164 brasileiro", () => {
    it.each([
        ["61999990001", "5561999990001"],
        ["6133445566", "556133445566"],
        ["5561999990001", "5561999990001"],
        ["556133445566", "556133445566"],
        ["+55 (61) 99999-0001", "5561999990001"],
        ["(61) 99999-0001", "5561999990001"],
        ["61 99999-0001", "5561999990001"],
    ])("%s → %s", (entrada, esperado) => {
        expect(normalizeBrPhone(entrada)).toBe(esperado);
    });
    it.each(["999990001", "123", "", "BR.13491208655302741918", "BR.1349120865", "446199990001", "55619999900011", "abc61999990001"])("%j → null", (entrada) => {
        expect(normalizeBrPhone(entrada)).toBeNull();
    });
    it.each([null, undefined, 61999990001, {}, []])("valor que não é texto (%j) → null", (entrada) => {
        expect(normalizeBrPhone(entrada)).toBeNull();
    });
    it("o evento com telefone nacional envia para 55+telefone", async () => {
        const { run, sendTemplate } = setup();
        await run(ev("order.created", { cliente: { nome: "x", telefone: "61999990001" } }));
        expect(sendTemplate.mock.calls[0][0]).toBe("5561999990001");
    });
    it.each(["5561999990001", "+55 (61) 99999-0001"])("telefone já com país (%s) também envia para 5561999990001", async (tel) => {
        const { run, sendTemplate } = setup();
        await run(ev("order.created", { cliente: { nome: "x", telefone: tel } }));
        expect(sendTemplate.mock.calls[0][0]).toBe("5561999990001");
    });
    it("o opt-out é consultado com o número JÁ normalizado", async () => {
        const isOptedOut = vi.fn().mockResolvedValue(false);
        const { run } = setup({ isOptedOut });
        await run(ev("order.created", { cliente: { nome: "x", telefone: "61999990001" } }));
        expect(isOptedOut).toHaveBeenCalledWith("pilot", "5561999990001@s.whatsapp.net");
    });
    it("a mesma pessoa com e sem 55 em eventos diferentes não recebe o mesmo template duas vezes? (a chave de dedupe é o pedido, não o telefone)", async () => {
        const { run, sendTemplate } = setup();
        await run(ev("order.created", { cliente: { nome: "x", telefone: "61999990001" } }));
        await run(ev("order.created", { cliente: { nome: "x", telefone: "5561999990001" } }, { sequence: 2 }));
        expect(sendTemplate).toHaveBeenCalledTimes(1);
    });
});
