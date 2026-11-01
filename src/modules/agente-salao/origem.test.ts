import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const createMany = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { mensagemOrigem: { upsert: (...a: unknown[]) => upsert(...a), createMany: (...a: unknown[]) => createMany(...a) } } }));

import { registrarOrigem } from "./origem";

const aguardar = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    upsert.mockReset().mockResolvedValue({});
    createMany.mockReset().mockResolvedValue({ count: 1 });
});

describe("registrarOrigem", () => {
    it('"ia" promove a linha existente (upsert)', async () => {
        registrarOrigem("s1", "K1", "ia");
        await aguardar();
        expect(upsert).toHaveBeenCalledWith({
            where: { sessionId_keyId: { sessionId: "s1", keyId: "K1" } },
            create: { sessionId: "s1", keyId: "K1", origem: "ia" },
            update: { origem: "ia" },
        });
        expect(createMany).not.toHaveBeenCalled();
    });
    it('"crm" nunca sobrescreve: createMany com skipDuplicates', async () => {
        registrarOrigem("s1", "K2", "crm");
        await aguardar();
        expect(createMany).toHaveBeenCalledWith({ data: [{ sessionId: "s1", keyId: "K2", origem: "crm" }], skipDuplicates: true });
        expect(upsert).not.toHaveBeenCalled();
    });
    it("sem id da mensagem não grava nada", async () => {
        registrarOrigem("s1", undefined, "ia");
        await aguardar();
        expect(upsert).not.toHaveBeenCalled();
    });
    it("falha do banco não lança erro (nunca impede o envio)", async () => {
        upsert.mockRejectedValue(new Error("db fora"));
        expect(() => registrarOrigem("s1", "K3", "ia")).not.toThrow();
        await aguardar();
    });
});
