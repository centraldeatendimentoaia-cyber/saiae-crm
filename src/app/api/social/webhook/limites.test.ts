import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const proc = vi.hoisted(() => ({ ativos: 0, maxAtivos: 0, total: 0 }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/automacoes/gatilhos/real", () => ({ depsReais: () => ({}) }));
vi.mock("@/modules/automacoes/gatilhos/roteador", () => ({
    processarEventoSocial: async () => { proc.total++; proc.ativos++; proc.maxAtivos = Math.max(proc.maxAtivos, proc.ativos); await new Promise((r) => setTimeout(r, 2)); proc.ativos--; return []; },
}));
import { POST } from "./route";

const SECRET = "s";
const assinar = (c: string) => `sha256=${createHmac("sha256", SECRET).update(c).digest("hex")}`;
beforeEach(() => { process.env.SOCIAL_META_APP_SECRET = SECRET; Object.assign(proc, { ativos: 0, maxAtivos: 0, total: 0 }); });
afterEach(() => { delete process.env.SOCIAL_META_APP_SECRET; });

describe("limites do webhook social", () => {
    it("corpo chunked sem content-length acima de 1 MB: 413 e leitura abortada", async () => {
        let enviados = 0;
        const body = new ReadableStream<Uint8Array>({ pull(c) { enviados++; c.enqueue(new Uint8Array(256 * 1024)); if (enviados > 100) c.close(); } });
        const req = new NextRequest("http://x/api/social/webhook", { method: "POST", body, duplex: "half", headers: { "x-hub-signature-256": "sha256=00" } } as never);
        expect((await POST(req)).status).toBe(413);
        expect(enviados).toBeLessThan(20); // parou cedo, não leu os ~25 MB
    });
    it("mais de 100 eventos: processa no máximo 100, em lotes de 5", async () => {
        const messaging = Array.from({ length: 150 }, (_, i) => ({ sender: { id: `U${i}` }, timestamp: Date.now(), message: { mid: `m${i}`, text: "oi" } }));
        const c = JSON.stringify({ object: "instagram", entry: [{ id: "IG1", messaging }] });
        const r = await POST(new NextRequest("http://x/api/social/webhook", { method: "POST", body: c, headers: { "x-hub-signature-256": assinar(c) } }));
        expect(r.status).toBe(200);
        await vi.waitFor(() => expect(proc.total).toBe(100), { timeout: 3000 });
        expect(proc.maxAtivos).toBeLessThanOrEqual(5);
    });
});
