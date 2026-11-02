import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ prisma: { contact: { findFirst: vi.fn() } } }));
vi.mock("./prisma", () => ({ prisma: h.prisma }));
vi.mock("./logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { resolveToPhoneJid, telefoneDoLid } from "./jid-utils";

const LID = "123456789@lid";
const TEL = "5561999990000@s.whatsapp.net";

beforeEach(() => vi.resetAllMocks());

describe("telefoneDoLid", () => {
    it("devolve o telefone do mapeamento do WhatsApp, sem o sufixo de dispositivo", async () => {
        const sock = { signalRepository: { lidMapping: { getPNForLID: vi.fn().mockResolvedValue("5561999990000:12@s.whatsapp.net") } } };
        expect(await telefoneDoLid(sock, LID)).toBe(TEL);
    });
    it("sem mapeamento ou com erro devolve null", async () => {
        expect(await telefoneDoLid({}, LID)).toBeNull();
        const quebrado = { signalRepository: { lidMapping: { getPNForLID: vi.fn().mockRejectedValue(new Error("x")) } } };
        expect(await telefoneDoLid(quebrado, LID)).toBeNull();
    });
});

describe("resolveToPhoneJid com o mapeamento do socket", () => {
    it("usa o socket quando nem a mensagem nem a agenda sabem o telefone", async () => {
        h.prisma.contact.findFirst.mockResolvedValue(null);
        expect(await resolveToPhoneJid(LID, "db1", null, async () => TEL)).toBe(TEL);
    });
    it("a agenda tem prioridade sobre o socket", async () => {
        h.prisma.contact.findFirst.mockResolvedValue({ jid: LID, remoteJidAlt: "5511@s.whatsapp.net", lid: LID });
        const viaSocket = vi.fn();
        expect(await resolveToPhoneJid(LID, "db1", null, viaSocket)).toBe("5511@s.whatsapp.net");
        expect(viaSocket).not.toHaveBeenCalled();
    });
    it("sem ninguém que saiba, mantém o LID", async () => {
        h.prisma.contact.findFirst.mockResolvedValue(null);
        expect(await resolveToPhoneJid(LID, "db1", null, async () => null)).toBe(LID);
    });
});
