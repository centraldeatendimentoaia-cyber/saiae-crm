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

describe("notificações unificadas", () => {
    const ler = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

    it("o menu tem uma entrada de Notificações, visível a todos", () => {
        const itens = navGroups.flatMap((g) => g.items).filter((i) => i.href.includes("notific"));
        expect(itens).toHaveLength(1);
        expect(itens[0].href).toBe("/dashboard/notificacoes");
        expect(itens[0].superadminOnly).toBeFalsy();
    });

    it("as rotas antigas só redirecionam para a tela nova", () => {
        expect(ler("src/app/dashboard/inbox/page.tsx")).toContain('redirect("/dashboard/notificacoes")');
        expect(ler("src/app/dashboard/notifications/page.tsx")).toContain('redirect("/dashboard/notificacoes?aba=enviar")');
    });

    it("o sino da barra superior abre a tela nova", () => {
        const navbar = ler("src/components/dashboard/navbar.tsx");
        expect(navbar).toContain("/dashboard/notificacoes");
        expect(navbar).not.toContain("/dashboard/inbox");
    });

    it("o papel é conferido no servidor e a aba Enviar só existe para SUPERADMIN", () => {
        const pagina = ler("src/app/dashboard/notificacoes/page.tsx");
        expect(pagina).not.toContain('"use client"');
        expect(pagina).toContain('role === "SUPERADMIN"');
        const abas = ler("src/components/notificacoes/notificacoes-abas.tsx");
        expect(abas).toMatch(/podeEnviar && \(\s*<TabsContent value="enviar"/);
    });

    it("o envio continua protegido no servidor pela API", () => {
        expect(ler("src/app/api/notifications/route.ts")).toContain('user?.role !== "SUPERADMIN"');
    });
});
