import { describe, it, expect, vi, beforeEach } from "vitest";

/** Corpo inválido em webhooks, usuários, sessões, bot e configurações do sistema: 400 em pt-BR antes de tocar no banco. */
const h = vi.hoisted(() => ({ prisma: new Proxy({}, { get: () => { throw new Error("não deveria tocar no banco"); } }) }));
vi.mock("@/lib/api-auth", () => ({
    getAuthenticatedUser: async () => ({ id: "u1", role: "SUPERADMIN" }),
    canAccessSession: async () => true,
    isAdmin: () => true,
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn(), createSession: vi.fn() } }));
vi.mock("@/lib/plans", () => ({ assertCanCreateSession: vi.fn(), PlanError: class extends Error {} }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn() } }));

const req = (corpo: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(corpo) }) as never;
const p = { params: Promise.resolve({ sessionId: "s1", id: "w1" }) };

const casos: Array<[string, () => Promise<object>, string, unknown]> = [
    ["webhook sem evento", () => import("./webhooks/[sessionId]/route"), "POST", { name: "n", url: "https://a.com", events: [] }],
    ["webhook com URL inválida", () => import("./webhooks/[sessionId]/route"), "POST", { name: "n", url: "ftp://a.com", events: ["*"] }],
    ["webhook (editar) com URL inválida", () => import("./webhooks/[sessionId]/[id]/route"), "PUT", { url: "nao-e-url" }],
    ["usuário com papel inválido", () => import("./users/[id]/route"), "PATCH", { role: "ROOT" }],
    ["usuário com senha curta", () => import("./users/[id]/route"), "PATCH", { password: "123" }],
    ["bot-config com modo inválido", () => import("./sessions/[sessionId]/bot-config/route"), "POST", { botMode: "TODOS" }],
    ["bot-config com limite negativo", () => import("./sessions/[sessionId]/bot-config/route"), "POST", { spamLimit: -1 }],
    ["sessão sem nome", () => import("./sessions/route"), "POST", { name: "" }],
    ["settings da sessão sem objeto", () => import("./sessions/[sessionId]/settings/route"), "PATCH", { config: "x" }],
    ["config do sistema com nome vazio", () => import("./settings/system/route"), "POST", { appName: "" }],
    ["chat: archive sem boolean", () => import("./chat/[sessionId]/[jid]/archive/route"), "PUT", {}],
    ["chat: presence inválida", () => import("./chat/[sessionId]/[jid]/presence/route"), "POST", { presence: "dancando" }],
    ["chat: mute sem boolean", () => import("./chat/[sessionId]/[jid]/mute/route"), "PUT", { duration: 10 }],
    ["chat: check com mais de 50 números", () => import("./chat/[sessionId]/check/route"), "POST", { numbers: Array.from({ length: 51 }, (_, i) => String(i + 1)) }],
    ["perfil: nome vazio", () => import("./profile/[sessionId]/name/route"), "PUT", { name: "" }],
];

beforeEach(() => vi.clearAllMocks());

describe("validação do corpo (zod) — webhooks, usuários, sessões e configurações", () => {
    for (const [nome, carregar, metodo, corpo] of casos) {
        it(`400 em pt-BR: ${nome}`, async () => {
            const mod = await carregar();
            const res = await (mod as Record<string, Function>)[metodo](req(corpo), p);
            expect(res.status).toBe(400);
            const j = await res.json();
            expect(j.status).toBe(false);
            expect(j.error).toBe(j.message);
            expect(typeof j.message).toBe("string");
        });
    }
});
