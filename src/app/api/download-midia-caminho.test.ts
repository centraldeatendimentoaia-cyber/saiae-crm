import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";

/** O download de mídia só lê arquivos de data/media, seja qual for o mediaUrl gravado. */
const h = vi.hoisted(() => ({
    mediaUrl: "" as string,
    lidos: [] as string[],
}));
vi.mock("fs", () => {
    const fs = {
        existsSync: (p: string) => { h.lidos.push(p); return true; },
        readFileSync: (p: string) => { h.lidos.push(p); return Buffer.from("x"); },
    };
    return { default: fs, ...fs };
});
vi.mock("@/lib/api-auth", () => ({ getAuthenticatedUser: async () => ({ id: "u1", role: "OWNER" }), canAccessSession: async () => true }));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        message: { findUnique: async () => ({ id: "m1", sessionId: "c1", type: "IMAGE", mediaUrl: h.mediaUrl }) },
        session: { findFirst: async () => ({ id: "c1" }) },
    },
}));

import { GET } from "./messages/[sessionId]/download/[messageId]/media/route";

const baixar = () => GET(new Request("http://x") as never, { params: Promise.resolve({ sessionId: "s1", messageId: "m1" }) });
const dir = path.resolve(process.cwd(), "data", "media");

beforeEach(() => { h.lidos = []; });

describe("download de mídia da mensagem: caminho preso a data/media", () => {
    it("/api/media/<arquivo> (formato que o servidor grava) lê data/media/<arquivo>", async () => {
        h.mediaUrl = "/api/media/s1-ABC123.jpg";
        expect((await baixar()).status).toBe(200);
        expect(h.lidos[0]).toBe(path.join(dir, "s1-ABC123.jpg"));
    });
    it.each(["../../.env", "/etc/passwd", "..\..\secret.txt", "/api/media/../../../package.json"])("valor malicioso %s nunca sai de data/media", async (v) => {
        h.mediaUrl = v;
        await baixar();
        for (const p of h.lidos) expect(p.startsWith(dir + path.sep)).toBe(true);
    });
    it("URL externa continua redirecionando", async () => {
        h.mediaUrl = "https://exemplo.com/a.jpg";
        const res = await baixar();
        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
    });
});
