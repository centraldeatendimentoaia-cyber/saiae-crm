import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    prisma: {
        mediaFile: { findMany: vi.fn(), deleteMany: vi.fn() },
        scheduledMessage: { findMany: vi.fn() },
        autoReply: { findMany: vi.fn() },
        story: { findMany: vi.fn() },
        scheduledPost: { findMany: vi.fn() },
        postSeries: { findMany: vi.fn() },
    },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import { limparMidiasAntigas, quotaMidiaBytes } from "./media-retention";

beforeEach(() => {
    vi.resetAllMocks();
    h.prisma.scheduledMessage.findMany.mockResolvedValue([]);
    h.prisma.autoReply.findMany.mockResolvedValue([]);
    h.prisma.story.findMany.mockResolvedValue([]);
    h.prisma.scheduledPost.findMany.mockResolvedValue([]);
    h.prisma.postSeries.findMany.mockResolvedValue([]);
    h.prisma.mediaFile.deleteMany.mockImplementation(async ({ where }) => ({ count: where.id.in.length }));
});

describe("limparMidiasAntigas", () => {
    it("com dias = 0 não faz nada", async () => {
        expect(await limparMidiasAntigas(0)).toBe(0);
        expect(h.prisma.mediaFile.findMany).not.toHaveBeenCalled();
    });
    it("apaga as antigas sem uso e poupa as referenciadas por postagem, série ou disparo", async () => {
        h.prisma.mediaFile.findMany.mockResolvedValueOnce([{ id: "cmaaaaaaaa1" }, { id: "cmbbbbbbbb2" }, { id: "cmcccccccc3" }, { id: "cmdddddddd4" }]);
        h.prisma.scheduledPost.findMany.mockResolvedValue([{ mediaIds: ["cmbbbbbbbb2"] }]);
        h.prisma.postSeries.findMany.mockResolvedValue([{ variants: [{ caption: "x", mediaIds: ["cmcccccccc3"] }] }]);
        h.prisma.scheduledMessage.findMany.mockResolvedValue([{ mediaUrl: "/api/uploads/cmdddddddd4" }]);
        expect(await limparMidiasAntigas(180)).toBe(1);
        expect(h.prisma.mediaFile.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["cmaaaaaaaa1"] } } });
    });
    it("só considera postagens e séries que ainda vão acontecer", async () => {
        h.prisma.mediaFile.findMany.mockResolvedValueOnce([{ id: "cmaaaaaaaa1" }]);
        await limparMidiasAntigas(180);
        expect(h.prisma.scheduledPost.findMany.mock.calls[0][0].where.status.in).toEqual(["DRAFT", "PENDING", "PAUSED", "PUBLISHING"]);
        expect(h.prisma.postSeries.findMany.mock.calls[0][0].where.status.in).toEqual(["ACTIVE", "PAUSED"]);
    });
});

describe("quotaMidiaBytes", () => {
    it("padrão 200 MB, configurável e 0 desliga", () => {
        delete process.env.MEDIA_QUOTA_MB;
        expect(quotaMidiaBytes()).toBe(200 * 1024 * 1024);
        process.env.MEDIA_QUOTA_MB = "0";
        expect(quotaMidiaBytes()).toBe(0);
        delete process.env.MEDIA_QUOTA_MB;
    });
});
