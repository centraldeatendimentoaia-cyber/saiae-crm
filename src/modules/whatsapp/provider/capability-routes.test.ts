import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { BaileysProvider } from "./baileys";
import type { Capability, ProviderCapabilities, WhatsAppProvider } from "./types";

/**
 * Rotas que só existem no Baileys devolvem 501 claro quando a sessão usa um provedor que não
 * suporta o recurso (Cloud API oficial). Com o Baileys (único provedor hoje) nada muda.
 */

const h = vi.hoisted(() => ({ getProvider: vi.fn(), getAuthenticatedUser: vi.fn(), canAccessSession: vi.fn(), getInstance: vi.fn() }));

vi.mock("@/modules/whatsapp/provider", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/modules/whatsapp/provider")>()),
    getProvider: h.getProvider,
}));
vi.mock("@/lib/api-auth", () => ({ getAuthenticatedUser: h.getAuthenticatedUser, canAccessSession: h.canAccessSession }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: h.getInstance } }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/webhook", () => ({ fireSentWebhook: vi.fn() }));

const NONE: ProviderCapabilities = {
    freeTextAnytime: false, templates: true, groups: false, polls: false, stickers: false, lists: false, contacts: false,
    locations: false, reactions: false, replies: false, forwarding: false, deleteMessage: false, editMessage: false,
    starMessage: false, mentions: false,
};
const cloudLike = (): WhatsAppProvider =>
    ({ name: "cloud-api", sessionId: "s1", capabilities: NONE, isConnected: () => true } as unknown as WhatsAppProvider);
const baileys = () => new BaileysProvider({ sessionId: "s1", socket: {} });

const M = "@/app/api/messages/[sessionId]";
const G = "@/app/api/groups/[sessionId]";

interface Case { label: string; mod: string; method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"; capability: Capability; multipart?: boolean }
const CASES: Case[] = [
    { label: "reação", mod: `${M}/[jid]/[messageId]/react/route`, method: "POST", capability: "reactions" },
    { label: "responder (por id)", mod: `${M}/[jid]/[messageId]/reply/route`, method: "POST", capability: "replies" },
    { label: "responder", mod: `${M}/[jid]/reply/route`, method: "POST", capability: "replies" },
    { label: "apagar mensagem", mod: `${M}/[jid]/[messageId]/route`, method: "DELETE", capability: "deleteMessage" },
    { label: "editar mensagem", mod: `${M}/[jid]/[messageId]/route`, method: "PATCH", capability: "editMessage" },
    { label: "favoritar", mod: `${M}/[jid]/[messageId]/star/route`, method: "POST", capability: "starMessage" },
    { label: "contato", mod: `${M}/[jid]/contact/route`, method: "POST", capability: "contacts" },
    { label: "lista", mod: `${M}/[jid]/list/route`, method: "POST", capability: "lists" },
    { label: "localização", mod: `${M}/[jid]/location/route`, method: "POST", capability: "locations" },
    { label: "enquete", mod: `${M}/[jid]/poll/route`, method: "POST", capability: "polls" },
    { label: "figurinha", mod: `${M}/[jid]/sticker/route`, method: "POST", capability: "stickers", multipart: true },
    { label: "encaminhar", mod: `${M}/forward/route`, method: "POST", capability: "forwarding" },
    { label: "grupo: descrição", mod: `${G}/[jid]/description/route`, method: "PUT", capability: "groups" },
    { label: "grupo: efêmeras", mod: `${G}/[jid]/ephemeral/route`, method: "PUT", capability: "groups" },
    { label: "grupo: convite (ver)", mod: `${G}/[jid]/invite/route`, method: "GET", capability: "groups" },
    { label: "grupo: convite (revogar)", mod: `${G}/[jid]/invite/route`, method: "PUT", capability: "groups" },
    { label: "grupo: sair", mod: `${G}/[jid]/leave/route`, method: "POST", capability: "groups" },
    { label: "grupo: membros", mod: `${G}/[jid]/members/route`, method: "PUT", capability: "groups" },
    { label: "grupo: foto (trocar)", mod: `${G}/[jid]/picture/route`, method: "PUT", capability: "groups", multipart: true },
    { label: "grupo: foto (remover)", mod: `${G}/[jid]/picture/route`, method: "DELETE", capability: "groups" },
    { label: "grupo: detalhes", mod: `${G}/[jid]/route`, method: "GET", capability: "groups" },
    { label: "grupo: configurações", mod: `${G}/[jid]/settings/route`, method: "PUT", capability: "groups" },
    { label: "grupo: nome", mod: `${G}/[jid]/subject/route`, method: "PUT", capability: "groups" },
    { label: "grupo: criar", mod: `${G}/create/route`, method: "POST", capability: "groups" },
    { label: "grupo: aceitar convite", mod: `${G}/invite/accept/route`, method: "POST", capability: "groups" },
];

const BODY = {
    question: "q", options: ["a", "b"], title: "t", footer: "f", contacts: [{ displayName: "x", vcard: "v" }], latitude: 1, longitude: 2,
    message: { text: "m" }, messageId: "m1", emoji: "👍", text: "t", fromJid: "a@s.whatsapp.net", toJids: ["b@s.whatsapp.net"],
    subject: "s", participants: ["a@s.whatsapp.net"], action: "add", description: "d", setting: "announcement", expiration: 0,
    inviteCode: "ABC", star: true,
};

function request(c: Case) {
    const url = "https://crm.exemplo.test/api/x";
    if (c.multipart) {
        const fd = new FormData();
        fd.append("file", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
        return new NextRequest(url, { method: c.method, body: fd });
    }
    if (c.method === "GET" || c.method === "DELETE") return new NextRequest(url, { method: c.method });
    return new NextRequest(url, { method: c.method, body: JSON.stringify(BODY), headers: { "content-type": "application/json" } });
}

const params = { params: Promise.resolve({ sessionId: "s1", jid: "5561999531848@s.whatsapp.net", messageId: "m1" }) };

async function run(c: Case) {
    const mod = await import(/* @vite-ignore */ c.mod);
    return mod[c.method](request(c), params) as Promise<Response>;
}

beforeEach(() => {
    h.getAuthenticatedUser.mockReset().mockResolvedValue({ id: "u1", role: "OWNER" });
    h.canAccessSession.mockReset().mockResolvedValue(true);
    h.getInstance.mockReset().mockReturnValue(undefined); // sem sessão em execução: rota segue e dá 503
    h.getProvider.mockReset();
});

describe("requireCapability", () => {
    it("provedor Cloud sem o recurso: 501 com código e recurso", async () => {
        const { requireCapability } = await import("./require");
        h.getProvider.mockReturnValue(cloudLike());
        const res = requireCapability("s1", "polls")!;
        expect(res.status).toBe(501);
        expect(await res.json()).toMatchObject({
            status: false, code: "CAPABILITY_NOT_SUPPORTED", capability: "polls", provider: "cloud-api",
            message: expect.stringContaining("enquetes"),
        });
    });
    it("Baileys: segue (null)", async () => {
        const { requireCapability } = await import("./require");
        h.getProvider.mockReturnValue(baileys());
        expect(requireCapability("s1", "polls")).toBeNull();
    });
    it("sessão fora do ar: segue (null), quem responde 503 é a rota", async () => {
        const { requireCapability } = await import("./require");
        h.getProvider.mockReturnValue(null);
        expect(requireCapability("s1", "groups")).toBeNull();
    });
    it("provedor Cloud COM o recurso: segue", async () => {
        const { requireCapability } = await import("./require");
        h.getProvider.mockReturnValue({ ...cloudLike(), capabilities: { ...NONE, polls: true } });
        expect(requireCapability("s1", "polls")).toBeNull();
    });
});

describe("rotas só-Baileys", () => {
    it.each(CASES)("$label ($method): 501 em sessão Cloud API", async (c) => {
        h.getProvider.mockReturnValue(cloudLike());
        const res = await run(c);
        expect(res.status).toBe(501);
        const body = await res.json();
        expect(body).toMatchObject({ code: "CAPABILITY_NOT_SUPPORTED", capability: c.capability });
    });

    it.each(CASES)("$label ($method): com Baileys não devolve 501 (comportamento inalterado)", async (c) => {
        h.getProvider.mockReturnValue(baileys());
        const res = await run(c);
        expect(res.status).not.toBe(501);
    });

    it("não autenticado: 401, nunca 501 (não vaza o provedor da sessão)", async () => {
        h.getProvider.mockReturnValue(cloudLike());
        h.getAuthenticatedUser.mockResolvedValue(null);
        const res = await run(CASES.find((c) => c.capability === "polls")!);
        expect(res.status).toBe(401);
    });

    it("sem acesso à sessão: 403, nunca 501", async () => {
        h.getProvider.mockReturnValue(cloudLike());
        h.canAccessSession.mockResolvedValue(false);
        const res = await run(CASES.find((c) => c.capability === "polls")!);
        expect(res.status).toBe(403);
    });
});
