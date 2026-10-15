import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    prisma: { mediaFile: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import { DbMediaStorage } from "./media-storage";

const st = new DbMediaStorage();
beforeEach(() => vi.resetAllMocks());

describe("DbMediaStorage", () => {
    it("save grava os bytes com o tamanho real e corta o nome em 200 caracteres", async () => {
        h.prisma.mediaFile.create.mockResolvedValue({ id: "m1" });
        const r = await st.save({ userId: "u", name: "x".repeat(300), mime: "image/png", data: Buffer.from([1, 2, 3]) });
        expect(r).toEqual({ id: "m1" });
        const d = h.prisma.mediaFile.create.mock.calls[0][0].data;
        expect(d.size).toBe(3);
        expect(d.name).toHaveLength(200);
    });
    it("load por id e por token público; ausente vira null", async () => {
        h.prisma.mediaFile.findUnique.mockResolvedValue({ data: new Uint8Array([9]), mime: "image/jpeg", userId: "u" });
        expect(await st.load({ id: "m1" })).toEqual({ data: Buffer.from([9]), mime: "image/jpeg", userId: "u" });
        h.prisma.mediaFile.findFirst.mockResolvedValue(null);
        expect(await st.load({ publicToken: "t" })).toBeNull();
        expect(h.prisma.mediaFile.findFirst.mock.calls[0][0].where).toEqual({ publicToken: "t" });
    });
    it("remove devolve quantas apagou", async () => {
        h.prisma.mediaFile.deleteMany.mockResolvedValue({ count: 2 });
        expect(await st.remove(["a", "b"])).toBe(2);
    });
});
