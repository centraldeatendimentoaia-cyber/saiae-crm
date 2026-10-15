import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ role: "OWNER" as string | null, canAccess: true }));
vi.mock("@/lib/api-auth", () => ({
    getAuthenticatedUser: async () => (h.role ? { id: "u1", role: h.role } : null),
    canAccessSession: async () => h.canAccess,
}));
vi.mock("@/lib/prisma", () => ({ prisma: { agenteConfig: { findUnique: vi.fn(async () => null) }, session: { findUnique: vi.fn(async () => ({ id: "x" })) } } }));
vi.mock("@/modules/agente-salao/agente", () => ({ limparCacheConfigAgente: vi.fn() }));

import { GET, PUT } from "./[sessionId]/config/route";

const p = { params: Promise.resolve({ sessionId: "s1" }) };
const get = () => GET(new Request("http://x") as never, p);

beforeEach(() => { h.role = "OWNER"; h.canAccess = true; });

describe("/api/agente/:sessionId/config só para SUPERADMIN", () => {
    it("sem login: 401", async () => { h.role = null; expect((await get()).status).toBe(401); });
    it("dono da sessão (OWNER): 403, mesmo com acesso à sessão", async () => {
        expect((await get()).status).toBe(403);
        expect((await PUT(new Request("http://x", { method: "PUT", body: "{}" }) as never, p)).status).toBe(403);
    });
    it("SUPERADMIN passa do guard", async () => {
        h.role = "SUPERADMIN";
        expect((await get()).status).not.toBe(403);
    });
});
