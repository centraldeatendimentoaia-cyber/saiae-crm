import { describe, expect, it } from "vitest";
import { criarEstado, lerEstado, urlDeAutorizacao } from "./oauth";

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
