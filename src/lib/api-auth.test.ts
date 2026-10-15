import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock("./prisma", () => ({ prisma: h.prisma }));
vi.mock("./auth", () => ({ auth: vi.fn() }));
vi.mock("./logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { validateApiKey } from "./api-auth";
import { generateApiKey, hashApiKey, apiKeyHint } from "./api-key";

const req = (key?: string) => ({ headers: { get: () => key ?? null } }) as never;
const USER = { id: "u1", email: "a@b.c", name: "A", role: "OWNER" };

beforeEach(() => vi.resetAllMocks());

describe("api-key helpers", () => {
    it("gera chave com prefixo e tamanho fixos, diferentes a cada chamada", () => {
        const a = generateApiKey();
        expect(a).toMatch(/^wag_[A-Za-z0-9]{32}$/);
        expect(generateApiKey()).not.toBe(a);
    });
    it("hash é sha256 hex determinístico e a máscara não revela a chave", () => {
        const k = "wag_" + "a".repeat(32);
        expect(hashApiKey(k)).toMatch(/^[0-9a-f]{64}$/);
        expect(hashApiKey(k)).toBe(hashApiKey(k));
        expect(apiKeyHint(k).endsWith("aaaa")).toBe(true);
        expect(apiKeyHint(k)).not.toContain("a".repeat(5));
    });
});

describe("validateApiKey", () => {
    it("sem cabeçalho retorna null sem consultar o banco", async () => {
        expect(await validateApiKey(req())).toBeNull();
        expect(h.prisma.user.findUnique).not.toHaveBeenCalled();
    });
    it("chave com hash no banco autentica sem tocar no legado", async () => {
        h.prisma.user.findUnique.mockResolvedValueOnce(USER);
        expect(await validateApiKey(req("wag_x"))).toEqual(USER);
        expect(h.prisma.user.findUnique).toHaveBeenCalledTimes(1);
        expect(h.prisma.user.findUnique.mock.calls[0][0].where).toEqual({ apiKeyHash: hashApiKey("wag_x") });
        expect(h.prisma.user.update).not.toHaveBeenCalled();
    });
    it("chave legada em texto puro autentica e migra para hash, apagando o texto puro", async () => {
        h.prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(USER);
        expect(await validateApiKey(req("wag_old"))).toEqual(USER);
        expect(h.prisma.user.update).toHaveBeenCalledWith({
            where: { id: "u1" },
            data: { apiKeyHash: hashApiKey("wag_old"), apiKeyHint: apiKeyHint("wag_old"), apiKey: null },
        });
    });
    it("chave desconhecida retorna null", async () => {
        h.prisma.user.findUnique.mockResolvedValue(null);
        expect(await validateApiKey(req("wag_nope"))).toBeNull();
        expect(h.prisma.user.update).not.toHaveBeenCalled();
    });
});
