import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    prisma: { mediaFile: { aggregate: vi.fn(), create: vi.fn() } },
    getAuthenticatedUser: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/api-auth", () => ({ getAuthenticatedUser: h.getAuthenticatedUser, canAccessSession: vi.fn() }));
vi.mock("@/lib/plans", () => ({ ownerIdOfSession: vi.fn() }));

import { POST } from "./route";

const reqCom = (file: File) => ({ formData: async () => ({ get: (k: string) => (k === "file" ? file : null) }) }) as never;
const img = (bytes: number, type = "image/png") => new File([new Uint8Array(bytes)], "a.png", { type });

beforeEach(() => {
    vi.resetAllMocks();
    h.getAuthenticatedUser.mockResolvedValue({ id: "u1", role: "OWNER" });
    h.prisma.mediaFile.create.mockResolvedValue({ id: "m1" });
});

describe("POST /api/uploads", () => {
    it("rejeita arquivo acima de 5 MB", async () => {
        const r = await POST(reqCom(img(5 * 1024 * 1024 + 1)));
        expect(r.status).toBe(400);
        expect(h.prisma.mediaFile.create).not.toHaveBeenCalled();
    });
    it("rejeita quando estoura a quota do dono (413)", async () => {
        h.prisma.mediaFile.aggregate.mockResolvedValue({ _sum: { size: 199 * 1024 * 1024 } });
        const r = await POST(reqCom(img(2 * 1024 * 1024)));
        expect(r.status).toBe(413);
        expect(h.prisma.mediaFile.create).not.toHaveBeenCalled();
    });
    it("aceita dentro da quota", async () => {
        h.prisma.mediaFile.aggregate.mockResolvedValue({ _sum: { size: 1024 } });
        const r = await POST(reqCom(img(1024)));
        expect(r.status).toBe(200);
        expect((await r.json()).data.url).toBe("/api/uploads/m1");
    });
});
