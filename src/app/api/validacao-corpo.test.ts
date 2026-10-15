import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Corpo inválido nas rotas de mensagens e grupos devolve 400 em pt-BR, no formato { status, message, error },
 * antes de qualquer efeito (envio, consulta de acesso).
 */
const h = vi.hoisted(() => ({
    canAccessSession: vi.fn(),
    sendTextMessage: vi.fn(),
}));
vi.mock("@/lib/api-auth", () => ({
    getAuthenticatedUser: async () => ({ id: "u1", role: "OWNER" }),
    canAccessSession: h.canAccessSession,
}));
vi.mock("@/modules/whatsapp/chat.service", () => ({ ChatService: { sendTextMessage: h.sendTextMessage } }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/webhook", () => ({ fireSentWebhook: vi.fn() }));
vi.mock("@/modules/whatsapp/capabilities", () => ({ requireCapability: () => null }));

const req = (corpo: unknown) => new Request("http://x", { method: "POST", body: typeof corpo === "string" ? corpo : JSON.stringify(corpo) }) as never;
const params = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ sessionId: "s1", jid: "5561@s.whatsapp.net", messageId: "m1", ...extra }) });

const casos: Array<[string, () => Promise<{ POST?: Function; PUT?: Function }>, unknown]> = [
    ["send sem message", () => import("./messages/[sessionId]/[jid]/send/route"), {}],
    ["send com message de tipo errado", () => import("./messages/[sessionId]/[jid]/send/route"), { message: 123 }],
    ["poll com 1 opção", () => import("./messages/[sessionId]/[jid]/poll/route"), { question: "q", options: ["a"] }],
    ["poll com selectableCount maior que as opções", () => import("./messages/[sessionId]/[jid]/poll/route"), { question: "q", options: ["a", "b"], selectableCount: 3 }],
    ["location fora da faixa", () => import("./messages/[sessionId]/[jid]/location/route"), { latitude: 91, longitude: 0 }],
    ["contact sem vcard", () => import("./messages/[sessionId]/[jid]/contact/route"), { contacts: [{ displayName: "A" }] }],
    ["forward sem destinatários", () => import("./messages/[sessionId]/forward/route"), { fromJid: "a", messageId: "b", toJids: [] }],
    ["grupo: members com ação inválida", () => import("./groups/[sessionId]/[jid]/members/route"), { action: "ban", participants: ["a"] }],
    ["grupo: ephemeral inválido", () => import("./groups/[sessionId]/[jid]/ephemeral/route"), { expiration: 5 }],
    ["grupo: subject longo demais", () => import("./groups/[sessionId]/[jid]/subject/route"), { subject: "x".repeat(101) }],
    ["JSON malformado", () => import("./messages/[sessionId]/[jid]/send/route"), "{nao json"],
];

beforeEach(() => {
    vi.clearAllMocks();
    h.canAccessSession.mockResolvedValue(true);
});

describe("validação do corpo (zod) — rotas de mensagens e grupos", () => {
    for (const [nome, carregar, corpo] of casos) {
        it(`400 em pt-BR: ${nome}`, async () => {
            const mod = await carregar();
            const handler = (mod.POST ?? mod.PUT)!;
            const res = await handler(req(corpo), params());
            expect(res.status).toBe(400);
            const j = await res.json();
            expect(j.status).toBe(false);
            expect(j.error).toBe(j.message);
            expect(j.message).not.toMatch(/is required|must be/i);
        });
    }

    it("corpo válido segue para o envio (contrato de sucesso intacto)", async () => {
        h.sendTextMessage.mockResolvedValue({ id: "x" });
        const { POST } = await import("./messages/[sessionId]/[jid]/send/route");
        const res = await POST(req({ message: "oi", mentions: null }), params());
        expect(res.status).toBe(200);
        expect(h.sendTextMessage).toHaveBeenCalledWith("s1", "5561@s.whatsapp.net", "oi", undefined, undefined);
    });
});
