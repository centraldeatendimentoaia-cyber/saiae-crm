import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
    prisma: { jobLock: { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn(), upsert: vi.fn() } },
}));
vi.mock("./prisma", () => ({ prisma: h.prisma }));
vi.mock("./logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { acquireJobLock, withJobLock, outrasInstanciasVivas, registrarInstancia } from "./job-lock";

const dup = Object.assign(new Error("unique"), { code: "P2002" });

beforeEach(() => {
    vi.resetAllMocks();
    h.prisma.jobLock.deleteMany.mockResolvedValue({ count: 1 });
    h.prisma.jobLock.updateMany.mockResolvedValue({ count: 0 });
});
afterEach(() => vi.useRealTimers());

describe("acquireJobLock", () => {
    it("pega a trava quando não existe linha", async () => {
        h.prisma.jobLock.create.mockResolvedValue({});
        expect(await acquireJobLock("j", 1000)).toBe(true);
    });
    it("não pega quando outra instância segura a trava ainda válida", async () => {
        h.prisma.jobLock.create.mockRejectedValue(dup);
        h.prisma.jobLock.updateMany.mockResolvedValue({ count: 0 });
        expect(await acquireJobLock("j", 1000)).toBe(false);
    });
    it("toma a trava expirada (UPDATE condicional em expiresAt < agora)", async () => {
        h.prisma.jobLock.create.mockRejectedValue(dup);
        h.prisma.jobLock.updateMany.mockResolvedValue({ count: 1 });
        expect(await acquireJobLock("j", 1000)).toBe(true);
        expect(h.prisma.jobLock.updateMany.mock.calls[0][0].where.expiresAt.lt).toBeInstanceOf(Date);
    });
    it("erro inesperado do banco: não executa o job", async () => {
        h.prisma.jobLock.create.mockRejectedValue(new Error("db fora"));
        expect(await acquireJobLock("j", 1000)).toBe(false);
    });
});

describe("withJobLock", () => {
    it("executa o job, devolve o resultado e libera a trava", async () => {
        h.prisma.jobLock.create.mockResolvedValue({});
        const fn = vi.fn().mockResolvedValue(42);
        expect(await withJobLock("j", 1000, fn)).toBe(42);
        expect(h.prisma.jobLock.deleteMany).toHaveBeenCalledTimes(1);
    });
    it("sem a trava, não executa o job", async () => {
        h.prisma.jobLock.create.mockRejectedValue(dup);
        const fn = vi.fn();
        expect(await withJobLock("j", 1000, fn)).toBeUndefined();
        expect(fn).not.toHaveBeenCalled();
        expect(h.prisma.jobLock.deleteMany).not.toHaveBeenCalled();
    });
    it("libera a trava mesmo se o job lançar erro", async () => {
        h.prisma.jobLock.create.mockResolvedValue({});
        await expect(withJobLock("j", 1000, async () => { throw new Error("x"); })).rejects.toThrow("x");
        expect(h.prisma.jobLock.deleteMany).toHaveBeenCalledTimes(1);
    });
    it("renova a trava enquanto o job demora", async () => {
        vi.useFakeTimers();
        h.prisma.jobLock.create.mockResolvedValue({});
        const p = withJobLock("j", 3000, () => new Promise<void>((r) => setTimeout(r, 5000)));
        await vi.advanceTimersByTimeAsync(5000);
        await p;
        expect(h.prisma.jobLock.updateMany).toHaveBeenCalled();
    });
});

describe("presença de instâncias", () => {
    it("conta só instâncias vivas (não expiradas) e exclui a própria", async () => {
        h.prisma.jobLock.count.mockResolvedValue(2);
        expect(await outrasInstanciasVivas()).toBe(2);
        const where = h.prisma.jobLock.count.mock.calls[0][0].where;
        expect(where.name.startsWith).toBe("instancia:");
        expect(where.name.not).toMatch(/^instancia:/);
        expect(where.expiresAt.gt).toBeInstanceOf(Date);
    });
    it("erro do banco conta como se houvesse outra instância (não mexe em nada)", async () => {
        h.prisma.jobLock.count.mockRejectedValue(new Error("fora"));
        expect(await outrasInstanciasVivas()).toBe(1);
    });
    it("registrarInstancia grava a presença e é idempotente", () => {
        vi.useFakeTimers();
        h.prisma.jobLock.upsert.mockResolvedValue({});
        registrarInstancia();
        registrarInstancia();
        expect(h.prisma.jobLock.upsert).toHaveBeenCalledTimes(1);
        expect(h.prisma.jobLock.upsert.mock.calls[0][0].where.name).toMatch(/^instancia:/);
    });
});
