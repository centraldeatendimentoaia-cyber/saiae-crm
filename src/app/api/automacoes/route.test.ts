import { describe, it, expect, vi, beforeEach } from "vitest";

/** Rotas /api/automacoes/*: autenticação e isolamento por usuário (IDOR) com o serviço real sobre um banco falso escopado. */
const h = vi.hoisted(() => {
    type Linha = Record<string, unknown>;
    const db = { flows: [] as Linha[], runs: [] as Linha[] };
    const casa = (l: Linha, w: Linha) => Object.entries(w).every(([k, v]) => (typeof v === "object" && v !== null ? true : l[k] === v));
    return {
        db,
        user: null as { id: string; role: string } | null,
        prisma: {
            automationFlow: {
                findFirst: vi.fn(async ({ where }: { where: Linha }) => db.flows.find((f) => casa(f, where)) ?? null),
                findMany: vi.fn(async ({ where }: { where: Linha }) => db.flows.filter((f) => casa(f, where))),
                updateMany: vi.fn(async ({ where }: { where: Linha }) => ({ count: db.flows.filter((f) => casa(f, where)).length })),
                create: vi.fn(async ({ data }: { data: Linha }) => ({ id: "novo", ...data })),
                update: vi.fn(),
            },
            automationFlowVersion: { findFirst: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn() },
            automationRun: {
                findFirst: vi.fn(async ({ where }: { where: Linha }) => db.runs.find((r) => casa(r, where)) ?? null),
                updateMany: vi.fn(async ({ where }: { where: Linha }) => ({ count: db.runs.filter((r) => casa(r, where)).length })),
                count: vi.fn(async () => 0),
                create: vi.fn(async () => ({ id: "r-novo" })),
            },
            session: { findFirst: vi.fn(async () => ({ sessionId: "loja" })) },
            contact: { findFirst: vi.fn(async () => ({ id: "c" })) },
            $transaction: vi.fn(),
        },
    };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/api-auth", () => ({
    getAuthenticatedUser: async () => h.user,
    canAccessSession: async (_u: string, _r: string, s: string) => s === "loja",
}));

const req = (corpo?: unknown) => new Request("http://x", { method: "POST", body: corpo === undefined ? undefined : JSON.stringify(corpo) }) as never;
const P = (o: Record<string, string>) => ({ params: Promise.resolve(o) }) as never;

beforeEach(() => {
    vi.clearAllMocks();
    h.user = { id: "ua", role: "OWNER" };
    h.db.flows = [{ id: "f-b", userId: "ub", sessionId: "loja", status: "active", publishedVersionId: "v1", draft: {} }];
    h.db.runs = [{ id: "r-b", userId: "ub", status: "waiting", steps: [] }];
});

describe("sem login: 401 em todas as rotas e nada é tocado", () => {
    it("rotas", async () => {
        h.user = null;
        const lista = await import("./route");
        const put = await import("./[id]/route");
        const ini = await import("./[id]/iniciar/route");
        const pub = await import("./[id]/publicar/route");
        const run = await import("./runs/[runId]/route");
        const can = await import("./runs/[runId]/cancelar/route");
        const rs = [
            await lista.GET(req()), await lista.POST(req({ sessionId: "loja", name: "x" })),
            await put.PUT(req({ draft: {} }), P({ id: "f-b" })),
            await ini.POST(req({ contactKey: "c" }), P({ id: "f-b" })),
            await pub.POST(req(), P({ id: "f-b" })),
            await run.GET(req(), P({ runId: "r-b" })),
            await can.POST(req(), P({ runId: "r-b" })),
        ];
        expect(rs.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401, 401]);
        expect(h.prisma.automationRun.updateMany).not.toHaveBeenCalled();
    });
});

describe("isolamento entre usuários (usuário A age sobre recursos de B)", () => {
    it("iniciar fluxo de outro usuário: 404, sem criar execução", async () => {
        const { POST } = await import("./[id]/iniciar/route");
        expect((await POST(req({ contactKey: "c" }), P({ id: "f-b" }))).status).toBe(404);
        expect(h.prisma.automationRun.create).not.toHaveBeenCalled();
    });
    it("publicar fluxo de outro usuário: 404, sem versão", async () => {
        const { POST } = await import("./[id]/publicar/route");
        expect((await POST(req(), P({ id: "f-b" }))).status).toBe(404);
        expect(h.prisma.$transaction).not.toHaveBeenCalled();
    });
    it("editar rascunho de outro usuário: 404", async () => {
        const { PUT } = await import("./[id]/route");
        expect((await PUT(req({ draft: { x: 1 } }), P({ id: "f-b" }))).status).toBe(404);
        expect(h.prisma.automationFlow.updateMany.mock.calls[0][0].where).toMatchObject({ id: "f-b", userId: "ua" });
    });
    it("ver execução de outro usuário: 404", async () => {
        const { GET } = await import("./runs/[runId]/route");
        expect((await GET(req(), P({ runId: "r-b" }))).status).toBe(404);
    });
    it("cancelar execução de outro usuário: 404", async () => {
        const { POST } = await import("./runs/[runId]/cancelar/route");
        expect((await POST(req(), P({ runId: "r-b" }))).status).toBe(404);
        expect(h.prisma.automationRun.updateMany.mock.calls[0][0].where).toMatchObject({ id: "r-b", userId: "ua" });
    });
    it("o dono (B) alcança os próprios recursos", async () => {
        h.user = { id: "ub", role: "OWNER" };
        const { GET } = await import("./runs/[runId]/route");
        expect((await GET(req(), P({ runId: "r-b" }))).status).toBe(200);
        const { POST } = await import("./runs/[runId]/cancelar/route");
        expect((await POST(req(), P({ runId: "r-b" }))).status).toBe(200);
    });
});

describe("criar fluxo e iniciar", () => {
    it("sessão sem acesso: 403", async () => {
        const { POST } = await import("./route");
        expect((await POST(req({ sessionId: "alheia", name: "x" }))).status).toBe(403);
        expect(h.prisma.automationFlow.create).not.toHaveBeenCalled();
    });
    it("criar com acesso: 201 e grava o nome da sessão", async () => {
        const { POST } = await import("./route");
        expect((await POST(req({ sessionId: "loja", name: "x" }))).status).toBe(201);
        expect(h.prisma.automationFlow.create.mock.calls[0][0].data).toMatchObject({ userId: "ua", sessionId: "loja" });
    });
    it("iniciar: contato desconhecido vira 400 e limite de taxa vira 429", async () => {
        h.user = { id: "ub", role: "OWNER" };
        h.prisma.automationFlowVersion.findUniqueOrThrow.mockResolvedValue({ id: "v1", definition: { start: "a" } });
        const { POST } = await import("./[id]/iniciar/route");
        h.prisma.contact.findFirst.mockResolvedValueOnce(null as never);
        expect((await POST(req({ contactKey: "c" }), P({ id: "f-b" }))).status).toBe(400);
        h.prisma.automationRun.count.mockResolvedValueOnce(0).mockResolvedValueOnce(999);
        expect((await POST(req({ contactKey: "c" }), P({ id: "f-b" }))).status).toBe(429);
    });
});
