import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-auth", () => ({ getAuthenticatedUser: vi.fn(async () => ({ id: "u1", role: "OWNER" })) }));
vi.mock("@/modules/social/graph", () => ({ discoverAccounts: vi.fn(async () => [{ pageId: "p" }]), GRAPH_VERSION: "v21.0" }));
vi.mock("@/modules/social/salvar-contas", () => ({ salvarContas: vi.fn(async () => []) }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { GET as callback } from "./callback/route";
import { GET as start } from "./start/route";
import { criarEstado } from "@/modules/social/oauth";

const ENV = ["BASE_URL", "NEXTAUTH_URL", "SOCIAL_META_APP_ID", "SOCIAL_META_APP_SECRET", "SOCIAL_META_CONFIG_ID"] as const;
const salvo: Record<string, string | undefined> = {};
const req = (path: string) => new NextRequest(`http://localhost:3030${path}`, { headers: { "x-forwarded-host": "interno" } });

beforeEach(() => {
    ENV.forEach((k) => { salvo[k] = process.env[k]; delete process.env[k]; });
    process.env.BASE_URL = "https://crm.exemplo.com";
    process.env.SOCIAL_META_APP_ID = "123";
    process.env.SOCIAL_META_APP_SECRET = "segredo";
});
afterEach(() => ENV.forEach((k) => { if (salvo[k] === undefined) delete process.env[k]; else process.env[k] = salvo[k]; }));

describe("rotas OAuth social", () => {
    it("start: manda à Meta com redirect_uri da BASE_URL e state assinado", async () => {
        const r = await start(req("/api/social/oauth/start"));
        const u = new URL(r.headers.get("location")!);
        expect(u.host).toBe("www.facebook.com");
        expect(u.searchParams.get("redirect_uri")).toBe("https://crm.exemplo.com/api/social/oauth/callback");
        expect(u.searchParams.get("state")).toBeTruthy();
    });
    it("start não configurado: volta para a BASE_URL, não para localhost", async () => {
        delete process.env.SOCIAL_META_APP_ID;
        const r = await start(req("/api/social/oauth/start"));
        expect(r.headers.get("location")).toBe("https://crm.exemplo.com/dashboard/redes-sociais/contas?oauth=nao-configurado");
    });
    it("callback: negado, state inválido e state de outro usuário voltam para a BASE_URL", async () => {
        for (const [qs, esperado] of [
            ["error=access_denied", "negado"],
            ["code=c&state=lixo", "invalido"],
            [`code=c&state=${criarEstado("outro", "segredo")}`, "invalido"],
        ]) {
            const r = await callback(req(`/api/social/oauth/callback?${qs}`));
            const l = new URL(r.headers.get("location")!);
            expect(l.origin).toBe("https://crm.exemplo.com");
            expect(l.searchParams.get("oauth")).toBe(esperado);
        }
    });
    it("callback feliz: troca o código com o mesmo redirect_uri registrado e volta ok para a BASE_URL", async () => {
        const chamadas: string[] = [];
        vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: URLSearchParams }) => {
            chamadas.push(init.body.get("redirect_uri") ?? "-");
            return new Response(JSON.stringify({ access_token: "tk" }), { status: 200 });
        }));
        try {
            const r = await callback(req(`/api/social/oauth/callback?code=c&state=${criarEstado("u1", "segredo")}`));
            const l = new URL(r.headers.get("location")!);
            expect(l.origin).toBe("https://crm.exemplo.com");
            expect(l.searchParams.get("oauth")).toBe("ok");
            expect(chamadas[0]).toBe("https://crm.exemplo.com/api/social/oauth/callback");
        } finally { vi.unstubAllGlobals(); }
    });
});
