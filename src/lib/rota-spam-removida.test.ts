import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));

import { proxy } from "@/proxy";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

beforeEach(() => auth.mockReset().mockResolvedValue(null));

describe("remoção da rota de envio repetido (/spam)", () => {
    it("o arquivo da rota não existe mais", () => {
        expect(fs.existsSync(path.join(root, "src/app/api/messages/[sessionId]/[jid]/spam"))).toBe(false);
    });

    it("não aparece em Swagger, documentação nem na lista de rotas do painel", () => {
        for (const file of ["swagger.json", "src/lib/swagger.ts", "docs/API_DOCUMENTATION.md", "src/app/dashboard/api-docs/page.tsx"]) {
            const text = read(file);
            expect(text, file).not.toMatch(/\/messages\/(\{sessionId\}|\[sessionId\])\/(\{jid\}|\[jid\])\/spam/);
            expect(text, file).not.toMatch(/Message bombing/i);
        }
    });

    it("o swagger.json continua sendo JSON válido e mantém as outras rotas de envio", () => {
        const spec = JSON.parse(read("swagger.json"));
        expect(spec.paths["/messages/{sessionId}/{jid}/send"]).toBeDefined();
        expect(spec.paths["/messages/{sessionId}/{jid}/sticker"]).toBeDefined();
        expect(spec.paths["/messages/{sessionId}/{jid}/spam"]).toBeUndefined();
    });
});

describe("proxy: /api/test deixou de ser público", () => {
    it("exige sessão (a rota nem existe, mas não pode ficar uma porta aberta)", async () => {
        const res = await proxy(new NextRequest("https://crm.exemplo.test/api/test", { method: "GET" }));
        expect(res.status).toBe(401);
    });
    it("/api/auth continua público (login)", async () => {
        const res = await proxy(new NextRequest("https://crm.exemplo.test/api/auth/session", { method: "GET" }));
        expect(res.headers.get("x-middleware-next")).toBe("1");
    });
});
