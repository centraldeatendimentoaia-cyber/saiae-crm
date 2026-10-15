import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { navGroups } from "./nav-items";

const root = path.resolve(__dirname, "../../..");
const hrefs = navGroups.flatMap((g) => g.items.map((i) => i.href));

describe("menu do painel (nav-items)", () => {
    it("não repete nenhum link", () => {
        expect(new Set(hrefs).size).toBe(hrefs.length);
    });

    it("tem uma única entrada de documentação da API, apontando para o Swagger", () => {
        expect(hrefs.filter((h) => h === "/swagger")).toHaveLength(1);
        expect(hrefs).not.toContain("/docs");
        expect(hrefs).not.toContain("/dashboard/api-docs");
    });

    it("toda página interna do menu existe em src/app", () => {
        for (const href of hrefs.filter((h) => h.startsWith("/dashboard"))) {
            const page = path.join(root, "src/app", href, "page.tsx");
            expect(fs.existsSync(page), href).toBe(true);
        }
    });
});

describe("documentação da API unificada", () => {
    it("as telas antigas de documentação não existem mais", () => {
        expect(fs.existsSync(path.join(root, "src/app/dashboard/api-docs"))).toBe(false);
        expect(fs.existsSync(path.join(root, "src/app/docs/docs-client.tsx"))).toBe(false);
    });

    it("/docs só redireciona para /swagger", () => {
        const page = fs.readFileSync(path.join(root, "src/app/docs/page.tsx"), "utf8");
        expect(page).toContain('redirect("/swagger")');
    });
});
