import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { barracaSessao: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));

import { limparCacheBarraca, sessaoEhDeBarraca } from "./barraca";

beforeEach(() => {
    findUnique.mockReset();
    limparCacheBarraca();
});

describe("sessaoEhDeBarraca", () => {
    it("true quando a sessão está em BarracaSessao", async () => {
        findUnique.mockResolvedValue({ id: "b1" });
        expect(await sessaoEhDeBarraca("s1")).toBe(true);
        expect(findUnique).toHaveBeenCalledWith({ where: { sessionId: "s1" }, select: { id: true } });
    });
    it("false para sessão sem barraca (comportamento de sempre)", async () => {
        findUnique.mockResolvedValue(null);
        expect(await sessaoEhDeBarraca("s2")).toBe(false);
    });
    it("usa cache: a segunda chamada não vai ao banco, e limpar o cache volta a consultar", async () => {
        findUnique.mockResolvedValue(null);
        await sessaoEhDeBarraca("s3");
        await sessaoEhDeBarraca("s3");
        expect(findUnique).toHaveBeenCalledTimes(1);
        limparCacheBarraca("s3");
        await sessaoEhDeBarraca("s3");
        expect(findUnique).toHaveBeenCalledTimes(2);
    });
    it("se o banco falhar, não bloqueia o agente", async () => {
        findUnique.mockRejectedValue(new Error("db fora"));
        expect(await sessaoEhDeBarraca("s4")).toBe(false);
    });
});
