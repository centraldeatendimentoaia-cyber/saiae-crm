import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const docs = path.resolve(__dirname, "../../docs");
const ler = (arq: string) => fs.readFileSync(path.join(docs, arq), "utf8");
const links = (md: string) => [...md.matchAll(/\]\((\.[^)#\s]+)\)/g)].map((m) => m[1]);

describe("índice da documentação (docs/README.md)", () => {
    it("todo link relativo do índice aponta para um arquivo que existe", () => {
        for (const l of links(ler("README.md"))) {
            expect(fs.existsSync(path.join(docs, l)), l).toBe(true);
        }
    });

    it("todo documento da raiz de docs está listado no índice", () => {
        const indice = ler("README.md");
        const arquivos = fs.readdirSync(docs).filter((f) => f.endsWith(".md") && f !== "README.md");
        for (const f of arquivos) expect(indice, f).toContain(`(./${f})`);
    });

    it("os documentos do upstream estão em docs/upstream e têm o aviso de origem", () => {
        const upstream = fs.readdirSync(path.join(docs, "upstream")).filter((f) => f.endsWith(".md"));
        expect(upstream).toEqual(
            expect.arrayContaining(["API_DOCUMENTATION.md", "API_ANALYSIS_REPORT.md", "PROJECT_DOCUMENTATION.md", "UPDATE_GUIDE.md"]),
        );
        for (const f of upstream) expect(ler(`upstream/${f}`), f).toContain("herdado do projeto original");
        expect(fs.existsSync(path.join(docs, "API_DOCUMENTATION.md"))).toBe(false);
    });

    it("os links relativos dos documentos do upstream continuam válidos", () => {
        for (const f of fs.readdirSync(path.join(docs, "upstream")).filter((x) => x.endsWith(".md"))) {
            for (const l of links(ler(`upstream/${f}`))) {
                expect(fs.existsSync(path.join(docs, "upstream", l)), `${f} -> ${l}`).toBe(true);
            }
        }
    });
});
