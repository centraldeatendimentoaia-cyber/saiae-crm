import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);
const { ehMariaDb, dicaPlugin } = require(path.resolve(process.cwd(), "scripts/backup-db.js")) as {
    ehMariaDb: (bin: string, v?: string) => boolean;
    dicaPlugin: (stderr: string) => string;
};

describe("backup-db: detecção do cliente", () => {
    it("MariaDB pela saída de --version, mesmo com o binário chamado mysqldump", () => {
        expect(ehMariaDb("mysqldump", "mysqldump from 11.4.12-MariaDB, client 10.19 for Linux (x86_64)")).toBe(true);
        expect(ehMariaDb("mariadb-dump", "mariadb-dump from 11.4.12-MariaDB")).toBe(true);
    });
    it("MySQL de verdade não recebe --skip-ssl", () => {
        expect(ehMariaDb("mysqldump", "mysqldump  Ver 8.0.36 for Linux on x86_64 (MySQL Community Server - GPL)")).toBe(false);
    });
    it("sem saída de versão, cai para o nome do binário", () => {
        expect(ehMariaDb("mariadb-dump", "")).toBe(true);
        expect(ehMariaDb("mysqldump", "")).toBe(false);
    });
});

describe("backup-db: aviso de plugin", () => {
    it("reconhece o erro do plugin ausente", () => {
        const e = "mariadb-dump: Got error: 1045: Plugin caching_sha2_password could not be loaded: Error loading shared library";
        expect(dicaPlugin(e)).toContain("caching_sha2_password.so");
    });
    it("outros erros não geram o aviso", () => {
        expect(dicaPlugin("Access denied for user")).toBe("");
        expect(dicaPlugin("")).toBe("");
    });
});
