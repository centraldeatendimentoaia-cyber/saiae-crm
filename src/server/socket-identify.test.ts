import { encode } from "next-auth/jwt";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => ({ prisma: {} }));
vi.mock("../lib/api-auth", () => ({ canAccessSession: vi.fn() }));

import { defaultDeps } from "./socket";

// Usa o JWT real do Auth.js (mesmo formato/cookie de produção), sem mock do decodificador.
describe("identify com cookie real do Auth.js", () => {
    process.env.AUTH_SECRET = "segredo-de-teste-com-tamanho-suficiente-123";
    const secret = process.env.AUTH_SECRET;

    it.each([["authjs.session-token"], ["__Secure-authjs.session-token"]])("lê %s", async (nome) => {
        const jwt = await encode({ token: { id: "u1", role: "OWNER" }, secret, salt: nome });
        const d = await defaultDeps();
        const r = await d.identify({ cookie: `outro=1; ${nome}=${jwt}` });
        expect(r?.userId).toBe("u1");
        expect(r?.exp).toBeGreaterThan(Date.now() / 1000);
    });
    it("recusa cookie assinado com outro segredo, cookie ausente e salt trocado", async () => {
        const d = await defaultDeps();
        const ruim = await encode({ token: { id: "u1" }, secret: "outro-segredo-de-teste-com-tamanho-123456", salt: "authjs.session-token" });
        expect(await d.identify({ cookie: `authjs.session-token=${ruim}` })).toBeNull();
        expect(await d.identify({})).toBeNull();
        const salt = await encode({ token: { id: "u1" }, secret, salt: "outro.nome" });
        expect(await d.identify({ cookie: `authjs.session-token=${salt}` })).toBeNull();
    });
});
