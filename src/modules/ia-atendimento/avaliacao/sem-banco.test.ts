import { describe, expect, it, vi } from "vitest";

// Se o avaliador (npm run ia:avaliar) puxar o banco ou o agendador, estes mocks explodem o import.
vi.mock("@/lib/prisma", () => {
    throw new Error("o avaliador não pode carregar o prisma");
});
vi.mock("@/modules/whatsapp/manager", () => {
    throw new Error("o avaliador não pode carregar o gerenciador do WhatsApp (que sobe o cron)");
});
vi.mock("@/lib/cron", () => {
    throw new Error("o avaliador não pode carregar o cron");
});

describe("avaliador sem banco nem cron", () => {
    it("importa o avaliador e os dois motores sem carregar prisma, WhatsApp nem cron", async () => {
        const avaliador = await import("./avaliar");
        const vendas = await import("../vendas/motor");
        expect(typeof avaliador.avaliar).toBe("function");
        expect(typeof vendas.criarResponderVendas).toBe("function");
    });
});
