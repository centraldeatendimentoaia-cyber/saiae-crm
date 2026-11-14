import { describe, expect, it } from "vitest";
import { baseUrl, criarEstado, lerEstado, urlDeAutorizacao, urlDeRetorno } from "./oauth";

describe("estado do login da Meta", () => {
    const t0 = 1_700_000_000_000;

    it("devolve o usuário quando a assinatura e o prazo estão certos", () => {
        expect(lerEstado(criarEstado("user-1", "segredo", t0), "segredo", t0 + 1000)).toBe("user-1");
    });
    it("recusa assinatura de outro segredo, estado adulterado e estado vencido", () => {
        const e = criarEstado("user-1", "segredo", t0);
        expect(lerEstado(e, "outro", t0)).toBeNull();
        const [u, exp, sig] = e.split(".");
        expect(lerEstado(`${Buffer.from("user-2").toString("base64url")}.${exp}.${sig}`, "segredo", t0)).toBeNull();
        expect(lerEstado(e, "segredo", t0 + 11 * 60 * 1000)).toBeNull();
        expect(lerEstado("lixo", "segredo", t0)).toBeNull();
        expect(u).toBeTruthy();
    });
    it("a URL de autorização leva app, retorno, estado e as permissões de publicar", () => {
        const u = new URL(urlDeAutorizacao("123", "https://crm.exemplo.com/api/social/oauth/callback", "abc", ""));
        expect(u.searchParams.get("client_id")).toBe("123");
        expect(u.searchParams.get("state")).toBe("abc");
        expect(u.searchParams.get("scope")).toContain("instagram_content_publish");
        expect(u.searchParams.get("config_id")).toBeNull();
    });
    it("com config_id usa a configuração do painel e não manda scope", () => {
        const u = new URL(urlDeAutorizacao("123", "https://crm.exemplo.com/api/social/oauth/callback", "abc", "999"));
        expect(u.searchParams.get("config_id")).toBe("999");
        expect(u.searchParams.get("override_default_response_type")).toBe("true");
        expect(u.searchParams.get("response_type")).toBe("code");
        expect(u.searchParams.has("scope")).toBe(false);
    });
});

describe("base URL do login da Meta", () => {
    const get = (h: Record<string, string>) => ({ get: (n: string) => h[n] ?? null });
    it("BASE_URL vence o origin e NEXTAUTH_URL é o segundo", () => {
        expect(baseUrl("http://localhost:3030", undefined, { BASE_URL: "https://crm.exemplo.com/", NEXTAUTH_URL: "https://x.com" } as never)).toBe("https://crm.exemplo.com");
        expect(baseUrl("http://0.0.0.0:3030", undefined, { NEXTAUTH_URL: "https://x.com" } as never)).toBe("https://x.com");
    });
    it("sem variável e origin público, usa o origin", () => {
        expect(baseUrl("https://crm.exemplo.com", undefined, {} as never)).toBe("https://crm.exemplo.com");
    });
    it("sem variável e origin loopback, usa o host do proxy (fora de produção)", () => {
        expect(baseUrl("http://localhost:3030", get({ "x-forwarded-host": "crm.exemplo.com", "x-forwarded-proto": "https" }), { NODE_ENV: "development" } as never)).toBe("https://crm.exemplo.com");
    });
    it("x-forwarded-host malformado é recusado", () => {
        for (const h of ["evil.com/path", "a b.com", "a.com@evil.com", "https://x.com"]) {
            expect(() => baseUrl("http://localhost:3030", get({ "x-forwarded-host": h }), { NODE_ENV: "development" } as never)).toThrow(/inválido/);
        }
        expect(baseUrl("http://localhost:3030", get({ "x-forwarded-host": "crm.exemplo.com:8443" }), { NODE_ENV: "development" } as never)).toBe("https://crm.exemplo.com:8443");
    });
    it("em produção, host do proxy sem BASE_URL não vale", () => {
        expect(() => baseUrl("http://localhost:3030", get({ "x-forwarded-host": "crm.exemplo.com" }), { NODE_ENV: "production" } as never)).toThrow(/BASE_URL/);
    });
    it("em produção, BASE_URL/NEXTAUTH_URL com localhost também falha; fora de produção passa", () => {
        for (const v of ["http://localhost:3030", "http://127.0.0.1", "http://0.0.0.0:80"]) {
            expect(() => baseUrl("https://x.com", undefined, { NODE_ENV: "production", BASE_URL: v } as never)).toThrow(/localhost/);
            expect(() => baseUrl("https://x.com", undefined, { NODE_ENV: "production", NEXTAUTH_URL: v } as never)).toThrow(/localhost/);
        }
        expect(baseUrl("https://x.com", undefined, { NODE_ENV: "development", BASE_URL: "http://localhost:3030" } as never)).toBe("http://localhost:3030");
    });
    it("em produção nunca devolve localhost/0.0.0.0", () => {
        for (const o of ["http://localhost:3030", "http://0.0.0.0:3030", "http://127.0.0.1:3030"]) {
            expect(() => baseUrl(o, undefined, { NODE_ENV: "production" } as never)).toThrow(/BASE_URL/);
        }
        expect(baseUrl("http://localhost:3030", undefined, { NODE_ENV: "development" } as never)).toBe("http://localhost:3030");
    });
    it("o redirect_uri com BASE_URL não muda (callback registrado na Meta)", () => {
        const antes = process.env.BASE_URL;
        process.env.BASE_URL = "https://crm.exemplo.com";
        try { expect(urlDeRetorno("http://localhost:3030")).toBe("https://crm.exemplo.com/api/social/oauth/callback"); }
        finally { if (antes === undefined) delete process.env.BASE_URL; else process.env.BASE_URL = antes; }
    });
});
