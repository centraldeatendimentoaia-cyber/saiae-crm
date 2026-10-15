import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ session: null as null | { user: { id: string; role?: string } }, dbRole: "OWNER" as string | null | Error }));
vi.mock("@/lib/auth", () => ({ auth: async () => h.session }));
vi.mock("@/lib/prisma", () => ({
    prisma: { user: { findUnique: async () => { if (h.dbRole instanceof Error) throw h.dbRole; return h.dbRole ? { role: h.dbRole } : null; } } },
}));

import { proxy } from "./proxy";
import { NextRequest } from "next/server";

const go = (path: string) => proxy(new NextRequest(`http://localhost${path}`));
const destino = (r: Response) => r.headers.get("location");

beforeEach(() => { h.session = { user: { id: "u1", role: "SUPERADMIN" } }; h.dbRole = "OWNER"; });

describe("proxy: páginas só do SUPERADMIN", () => {
    it("papel vem do banco: token diz SUPERADMIN mas o banco diz OWNER → barra", async () => {
        expect(destino(await go("/dashboard/users"))).toBe("http://localhost/dashboard");
    });
    it("SUPERADMIN no banco passa", async () => {
        h.dbRole = "SUPERADMIN";
        expect(destino(await go("/dashboard/users"))).toBeNull();
    });
    it("erro no banco ou usuário removido: nega", async () => {
        h.dbRole = new Error("fora");
        expect(destino(await go("/dashboard/agente-ia"))).toBe("http://localhost/dashboard");
        h.dbRole = null;
        expect(destino(await go("/dashboard/atendente-ia"))).toBe("http://localhost/dashboard");
    });
    it("página comum não consulta o banco nem é barrada", async () => {
        h.dbRole = new Error("não deveria consultar");
        expect(destino(await go("/dashboard/sessions"))).toBeNull();
    });
    it("sem login: vai para o login", async () => {
        h.session = null;
        expect(destino(await go("/dashboard/users"))).toContain("/auth/login");
    });
});
