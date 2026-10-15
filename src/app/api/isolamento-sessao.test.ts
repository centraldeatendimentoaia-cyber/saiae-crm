import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regressão: recurso buscado só por id não pode ser tocado a partir de outra sessão.
 * O usuário tem acesso à sessão "s1" (canAccessSession verdadeiro) e tenta agir em recursos de outra.
 */
const h = vi.hoisted(() => ({
    role: "OWNER",
    prisma: {
        autoReply: { findFirst: vi.fn(), update: vi.fn() },
        label: { findUnique: vi.fn() },
        chatLabel: { deleteMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
        message: { findUnique: vi.fn() },
        session: { findFirst: vi.fn() },
    },
}));
vi.mock("@/lib/api-auth", () => ({
    getAuthenticatedUser: async () => ({ id: "u1", role: h.role }),
    canAccessSession: async (_u: string, role: string, s: string) => role === "SUPERADMIN" || s === "s1" || s === "key1",
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

const body = (corpo: unknown, method = "PUT") => new Request("http://x", { method, body: JSON.stringify(corpo) }) as never;
const P = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ sessionId: "s1", replyId: "r-outra", jid: "5561@s.whatsapp.net", ...extra }) });

beforeEach(() => { vi.clearAllMocks(); h.role = "OWNER"; });

describe("autoreplies PUT só edita regra da sessão da URL", () => {
    it("regra de outra sessão: 404 e nada é atualizado", async () => {
        h.prisma.autoReply.findFirst.mockResolvedValue(null);
        const { PUT } = await import("./autoreplies/[sessionId]/[replyId]/route");
        const res = await PUT(body({ keyword: "a", response: "b" }), P());
        expect(res.status).toBe(404);
        expect(h.prisma.autoReply.update).not.toHaveBeenCalled();
        expect(h.prisma.autoReply.findFirst.mock.calls[0][0].where).toEqual({ id: "r-outra", session: { OR: [{ sessionId: "s1" }, { id: "s1" }] } });
    });
    it("regra da própria sessão: atualiza", async () => {
        h.prisma.autoReply.findFirst.mockResolvedValue({ id: "r1" });
        h.prisma.autoReply.update.mockResolvedValue({ id: "r1" });
        const { PUT } = await import("./autoreplies/[sessionId]/[replyId]/route");
        expect((await PUT(body({ keyword: "a", response: "b" }), P())).status).toBe(200);
        expect(h.prisma.autoReply.update).toHaveBeenCalled();
    });
});

describe("etiquetas do chat: remover só afeta etiquetas da sessão da URL", () => {
    it("deleteMany filtra por label.sessionId", async () => {
        h.prisma.chatLabel.deleteMany.mockResolvedValue({ count: 0 });
        h.prisma.chatLabel.findMany.mockResolvedValue([]);
        const { PUT } = await import("./labels/[sessionId]/chat/[jid]/labels/route");
        await PUT(body({ labelIds: ["label-de-outra-sessao"], action: "remove" }), P());
        expect(h.prisma.chatLabel.deleteMany.mock.calls[0][0].where.label).toEqual({ sessionId: "s1" });
    });
});

describe("mídia por nome de arquivo: nome fora do padrão não escapa da checagem de dono", () => {
    it("GET /api/media/:filename sem '-' no nome: OWNER recebe 403", async () => {
        const { GET } = await import("./media/[filename]/route");
        const res = await GET(new Request("http://x") as never, { params: Promise.resolve({ filename: "semtraco.jpg" }) });
        expect(res.status).toBe(403);
    });
    it("GET com SUPERADMIN passa da checagem (arquivo inexistente = 404)", async () => {
        h.role = "SUPERADMIN";
        const { GET } = await import("./media/[filename]/route");
        const res = await GET(new Request("http://x") as never, { params: Promise.resolve({ filename: "semtraco-inexistente.jpg" }) });
        expect(res.status).toBe(404);
    });
    it("GET de arquivo de sessão alheia: 403", async () => {
        const { GET } = await import("./media/[filename]/route");
        const res = await GET(new Request("http://x") as never, { params: Promise.resolve({ filename: "outra-sessao-ABC123.jpg" }) });
        expect(res.status).toBe(403);
    });
    it("DELETE /api/media com nome fora do padrão: recusado para OWNER", async () => {
        const { DELETE } = await import("./media/route");
        const res = await DELETE(body({ filenames: ["semtraco.jpg"] }, "DELETE"));
        const j = await res.json();
        expect(j.data.deleted).toBe(0);
        expect(j.data.errors[0]).toMatch(/^Forbidden/);
    });
});

describe("download de mídia da mensagem", () => {
    const Pm = { params: Promise.resolve({ sessionId: "key1", messageId: "m1" }) };
    it("aceita a URL com o nome da sessão quando a mensagem é dela (id interno)", async () => {
        h.prisma.message.findUnique.mockResolvedValue({ id: "m1", sessionId: "cuid-1", mediaUrl: null });
        h.prisma.session.findFirst.mockResolvedValue({ id: "cuid-1" });
        const { GET } = await import("./messages/[sessionId]/download/[messageId]/media/route");
        expect((await GET(new Request("http://x") as never, Pm)).status).toBe(404); // passou da checagem; sem mídia
    });
    it("mensagem de outra sessão: 403", async () => {
        h.prisma.message.findUnique.mockResolvedValue({ id: "m1", sessionId: "cuid-outra", mediaUrl: "/x" });
        h.prisma.session.findFirst.mockResolvedValue({ id: "cuid-1" });
        const { GET } = await import("./messages/[sessionId]/download/[messageId]/media/route");
        expect((await GET(new Request("http://x") as never, Pm)).status).toBe(403);
    });
});
