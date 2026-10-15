import { describe, it, expect, vi, beforeEach } from "vitest";

/** Corpo inválido em labels, autoreplies, scheduler, notificações, mídia, sessões (ações) e social: 400 em pt-BR antes de tocar no banco. */
const h = vi.hoisted(() => ({ prisma: new Proxy({}, { get: (_t, prop) => { if (prop === "user") return { findUnique: async () => ({ role: "SUPERADMIN" }) }; throw new Error("não deveria tocar no banco"); } }) }));
vi.mock("@/lib/api-auth", () => ({
    getAuthenticatedUser: async () => ({ id: "u1", role: "SUPERADMIN" }),
    canAccessSession: async () => true,
    isAdmin: () => true,
}));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn(), requestPairingCode: vi.fn() } }));

const req = (corpo: unknown, method = "POST") => new Request("http://x", { method, body: JSON.stringify(corpo) }) as never;
const p = { params: Promise.resolve({ sessionId: "s1", id: "i1", labelId: "l1", replyId: "r1", scheduleId: "c1", jid: "5561@s.whatsapp.net", action: "pair" }) };

type Caso = [string, () => Promise<object>, string, unknown];
const casos: Caso[] = [
    ["label sem nome", () => import("./labels/[sessionId]/route"), "POST", { name: "" }],
    ["label com cor fracionada", () => import("./labels/[sessionId]/route"), "POST", { name: "x", color: 1.5 }],
    ["label (editar) com cor em texto", () => import("./labels/[sessionId]/[labelId]/route"), "PUT", { color: "azul" }],
    ["etiquetar chat com ação inválida", () => import("./labels/[sessionId]/chat/[jid]/labels/route"), "PUT", { labelIds: [], action: "toggle" }],
    ["autoreply sem palavra-chave", () => import("./autoreplies/[sessionId]/route"), "POST", { response: "oi" }],
    ["autoreply sem resposta nem mídia", () => import("./autoreplies/[sessionId]/route"), "POST", { keyword: "oi" }],
    ["autoreply com matchType inválido", () => import("./autoreplies/[sessionId]/route"), "POST", { keyword: "a", response: "b", matchType: "PARECIDO" }],
    ["autoreply (editar) com triggerType inválido", () => import("./autoreplies/[sessionId]/[replyId]/route"), "PUT", { keyword: "a", response: "b", triggerType: "X" }],
    ["agendamento sem data", () => import("./scheduler/[sessionId]/route"), "POST", { jid: "a", content: "x" }],
    ["agendamento com cron inválido", () => import("./scheduler/[sessionId]/route"), "POST", { jid: "a", content: "x", sendAt: "2030-01-01 10:00", cronExpression: "isso não é cron" }],
    ["agendamento (editar) sem destinatário", () => import("./scheduler/[sessionId]/[scheduleId]/route"), "PUT", { content: "x", sendAt: "2030-01-01 10:00" }],
    ["agendamento (editar) sem texto nem mídia", () => import("./scheduler/[sessionId]/[scheduleId]/route"), "PUT", { jid: "a", sendAt: "2030-01-01 10:00" }],
    ["notificação sem título", () => import("./notifications/route"), "POST", { message: "m", broadcast: true }],
    ["notificação sem destino", () => import("./notifications/route"), "POST", { title: "t", message: "m" }],
    ["notificações lidas com ids que não é lista", () => import("./notifications/read/route"), "PATCH", { ids: "abc" }],
    ["mídia: apagar sem arquivos", () => import("./media/route"), "DELETE", { filenames: [] }],
    ["sessão: ação com corpo que não é objeto", () => import("./sessions/[sessionId]/[action]/route"), "POST", [1, 2]],
    ["social: postagem com corpo que não é objeto", () => import("./social/posts/route"), "POST", null],
    ["social: série com corpo que não é objeto", () => import("./social/series/route"), "POST", "texto"],
    ["social: assinatura com corpo que não é objeto", () => import("./social/signatures/route"), "POST", [1]],
    ["opt-out com corpo que não é objeto", () => import("./optouts/[sessionId]/route"), "POST", [1]],
];

beforeEach(() => vi.clearAllMocks());

describe("validação do corpo (zod) — demais rotas", () => {
    for (const [nome, carregar, metodo, corpo] of casos) {
        it(`400 em pt-BR: ${nome}`, async () => {
            const mod = (await carregar()) as Record<string, (...a: unknown[]) => Promise<Response>>;
            const res = await mod[metodo](req(corpo, metodo), p);
            expect(res.status).toBe(400);
            const j = await res.json();
            expect(j.status).toBe(false);
            expect(typeof j.message).toBe("string");
            expect(j.message).not.toMatch(/is required|Missing|Invalid|must be/);
        });
    }
});
