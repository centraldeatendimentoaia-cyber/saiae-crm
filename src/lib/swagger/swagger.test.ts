import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { getApiDocs } from "./index";

type Operacao = { tags?: string[]; responses?: Record<string, unknown>; parameters?: { name?: string; $ref?: string }[] };
type Spec = {
    openapi: string;
    paths: Record<string, Record<string, Operacao>>;
    components: { schemas: Record<string, unknown>; responses: Record<string, unknown>; securitySchemes: Record<string, unknown> };
};

const raiz = path.resolve(__dirname, "../../..");
const spec = getApiDocs() as Spec;

describe("especificação OpenAPI (fonte única em src/lib/swagger)", () => {
    it("tem as seções básicas e muitas rotas", () => {
        expect(spec.openapi).toBe("3.0.0");
        expect(Object.keys(spec.paths).length).toBeGreaterThanOrEqual(80);
        expect(Object.keys(spec.components.securitySchemes)).toEqual(expect.arrayContaining(["ApiKeyAuth", "SessionAuth"]));
    });

    it("toda referência #/components/... aponta para algo que existe", () => {
        const texto = JSON.stringify(spec);
        const refs = new Set([...texto.matchAll(/"\$ref":"#\/components\/(schemas|responses)\/([^"]+)"/g)].map((m) => `${m[1]}/${m[2]}`));
        expect(refs.size).toBeGreaterThan(0);
        for (const ref of refs) {
            const [tipo, nome] = ref.split("/");
            expect(spec.components[tipo as "schemas" | "responses"], ref).toHaveProperty(nome);
        }
    });

    it("toda operação tem tag e pelo menos uma resposta", () => {
        for (const [rota, metodos] of Object.entries(spec.paths)) {
            for (const [metodo, op] of Object.entries(metodos)) {
                expect(op.tags?.length, `${metodo} ${rota} sem tag`).toBeGreaterThan(0);
                expect(Object.keys(op.responses ?? {}).length, `${metodo} ${rota} sem resposta`).toBeGreaterThan(0);
            }
        }
    });

    it("todo parâmetro {x} do caminho está declarado na operação", () => {
        for (const [rota, metodos] of Object.entries(spec.paths)) {
            const esperados = [...rota.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
            for (const [metodo, op] of Object.entries(metodos)) {
                const declarados = (op.parameters ?? []).map((p) => p.name);
                for (const nome of esperados) expect(declarados, `${metodo} ${rota}: falta o parâmetro ${nome}`).toContain(nome);
            }
        }
    });

    it("não existe mais cópia da spec em swagger.json nem o swagger.ts gigante", () => {
        expect(fs.existsSync(path.join(raiz, "swagger.json"))).toBe(false);
        expect(fs.existsSync(path.join(raiz, "src/lib/swagger.ts"))).toBe(false);
    });

    it("cada arquivo de área tem tamanho razoável (sem voltar ao arquivo único)", () => {
        const dir = path.join(raiz, "src/lib/swagger/paths");
        for (const arq of fs.readdirSync(dir)) {
            const linhas = fs.readFileSync(path.join(dir, arq), "utf8").split("\n").length;
            expect(linhas, arq).toBeLessThan(1000);
        }
    });
});
