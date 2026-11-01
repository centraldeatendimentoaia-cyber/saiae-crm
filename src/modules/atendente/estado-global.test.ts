import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ carregarPublicado: vi.fn(async () => null) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/agente-salao/barraca", () => ({ sessaoEhDeBarraca: vi.fn(async () => false) }));
vi.mock("./armazenamento", () => ({ carregarPublicado: mocks.carregarPublicado }));

// Uma rota do Next e o agente do WhatsApp podem carregar o módulo em grafos diferentes (mesmo processo): o estado tem que ser um só.
describe("estado compartilhado entre instâncias do módulo", () => {
    beforeEach(() => {
        mocks.carregarPublicado.mockClear();
    });

    it("limparCacheAtendente de uma instância limpa o cache usado pela outra", async () => {
        const a = await import("./integracao");
        a.limparCacheAtendente();
        await a.usarAtendenteNovo("s1");
        await a.usarAtendenteNovo("s1");
        expect(mocks.carregarPublicado).toHaveBeenCalledTimes(1);

        vi.resetModules();
        const b = await import("./integracao");
        expect(b).not.toBe(a);
        b.limparCacheAtendente("s1");

        await a.usarAtendenteNovo("s1");
        expect(mocks.carregarPublicado).toHaveBeenCalledTimes(2);
    });

    it("o limite de uso por usuário é um só entre instâncias", async () => {
        const a = await import("./teste");
        a.zerarLimite();
        expect(a.liberarUso("u1", a.LIMITE_POR_MINUTO)).toBe(true);
        vi.resetModules();
        const b = await import("./teste");
        expect(b.liberarUso("u1", 1)).toBe(false);
        b.zerarLimite();
        expect(a.liberarUso("u1", 1)).toBe(true);
    });
});
