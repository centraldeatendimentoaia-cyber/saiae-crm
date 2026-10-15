import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ getAuthenticatedUser: h.getAuthenticatedUser }));

import { PAGINAS_SO_SUPERADMIN, paginaSoParaSuperadmin } from "./superadmin-pages";
import { exigirSuperadmin } from "./admin-auth";
import { navGroups } from "@/components/dashboard/nav-items";

beforeEach(() => vi.resetAllMocks());

describe("paginaSoParaSuperadmin", () => {
    it("barra a página e as subpáginas, mas não prefixos parecidos", () => {
        expect(paginaSoParaSuperadmin("/dashboard/users")).toBe(true);
        expect(paginaSoParaSuperadmin("/dashboard/users/abc")).toBe(true);
        expect(paginaSoParaSuperadmin("/dashboard/users-extra")).toBe(false);
        expect(paginaSoParaSuperadmin("/dashboard/sessions")).toBe(false);
    });
    it("a lista é igual aos itens superadminOnly do menu", () => {
        const doMenu = navGroups.flatMap((g) => g.items).filter((i) => i.superadminOnly).map((i) => i.href).sort();
        expect([...PAGINAS_SO_SUPERADMIN].sort()).toEqual(doMenu);
    });
});

describe("exigirSuperadmin", () => {
    const req = {} as never;
    it("401 sem login, 403 para não superadmin, null para superadmin", async () => {
        h.getAuthenticatedUser.mockResolvedValueOnce(null);
        expect((await exigirSuperadmin(req))?.status).toBe(401);
        h.getAuthenticatedUser.mockResolvedValueOnce({ id: "1", role: "OWNER" });
        expect((await exigirSuperadmin(req))?.status).toBe(403);
        h.getAuthenticatedUser.mockResolvedValueOnce({ id: "1", role: "SUPERADMIN" });
        expect(await exigirSuperadmin(req)).toBeNull();
    });
});
