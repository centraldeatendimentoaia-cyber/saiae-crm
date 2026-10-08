import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import { apagarConversasDaLoja, apagarConversasDoCliente, variantesDoTelefone } from "./apagar";
import { SEM_LOJA } from "./store";

describe("variantesDoTelefone", () => {
    it("celular com 9º dígito gera também a forma sem o 9", () => {
        expect(variantesDoTelefone("5561988887777")?.sort()).toEqual(["556188887777", "5561988887777"].sort());
    });
    it("forma sem o 9º dígito gera a forma com 9", () => {
        expect(variantesDoTelefone("556188887777")?.sort()).toEqual(["556188887777", "5561988887777"].sort());
    });
    it("telefone nacional é normalizado com 55", () => {
        expect(variantesDoTelefone("61988887777")).toContain("5561988887777");
    });
    it("fixo (8 dígitos que não começam com 9) mantém só a forma original", () => {
        expect(variantesDoTelefone("556133334444")).toContain("556133334444");
    });
    it.each(["", "123", "BR.123"])("inválido %j: null", (t) => {
        expect(variantesDoTelefone(t)).toBeNull();
    });
});

describe("apagarConversasDoCliente", () => {
    it("apaga na loja e na conversa sem loja, para as variantes do número, e devolve a contagem", async () => {
        const apagar = vi.fn(async () => 2);
        const logger = { info: vi.fn() };
        expect(await apagarConversasDoCliente("ABC234", "5561988887777", { apagar, logger })).toBe(2);
        const [lojas, chaves] = apagar.mock.calls[0] as unknown as [string[], string[]];
        expect(lojas).toEqual(["ABC234", SEM_LOJA]);
        expect(chaves).toContain("5561988887777");
        expect(chaves).toContain("556188887777");
    });
    it("telefone inválido: null e nada apagado", async () => {
        const apagar = vi.fn(async () => 0);
        expect(await apagarConversasDoCliente("ABC234", "BR.1", { apagar, logger: { info: vi.fn() } })).toBeNull();
        expect(apagar).not.toHaveBeenCalled();
    });
    it("idempotente e sem telefone no log", async () => {
        const logger = { info: vi.fn() };
        expect(await apagarConversasDoCliente("ABC234", "5561988887777", { apagar: async () => 0, logger })).toBe(0);
        expect(JSON.stringify(logger.info.mock.calls)).not.toContain("5561988887777");
    });
});

describe("apagarConversasDaLoja", () => {
    it("apaga a loja inteira e devolve a contagem", async () => {
        const apagarLoja = vi.fn(async () => 7);
        expect(await apagarConversasDaLoja("ABC234", { apagarLoja, logger: { info: vi.fn() } })).toBe(7);
        expect(apagarLoja).toHaveBeenCalledWith("ABC234");
    });
});
