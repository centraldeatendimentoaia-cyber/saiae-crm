import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");

function arquivos(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return arquivos(p);
        return /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith("biblioteca-de-datas.test.ts") ? [p] : [];
    });
}

describe("uma só biblioteca de datas (moment-timezone)", () => {
    it("o package.json não declara date-fns nem moment solto", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        expect(pkg.dependencies["moment-timezone"]).toBeDefined();
        expect(pkg.dependencies["date-fns"]).toBeUndefined();
        expect(pkg.dependencies["moment"]).toBeUndefined();
    });

    it("nenhum arquivo de src importa date-fns", () => {
        const usam = arquivos(path.join(root, "src")).filter((f) => /from ["']date-fns/.test(fs.readFileSync(f, "utf8")));
        expect(usam).toEqual([]);
    });
});
