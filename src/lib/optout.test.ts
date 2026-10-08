import { describe, it, expect, vi, beforeEach } from "vitest";

const { optOut } = vi.hoisted(() => ({
    optOut: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { optOut } }));

import { isOptOutText, isOptInText, phoneKey, withFooter, OPTOUT_FOOTER, isOptedOut, addOptOut } from "./optout";

beforeEach(() => {
    optOut.findUnique.mockReset();
    optOut.upsert.mockReset();
});

describe("isOptOutText / isOptInText", () => {
    it.each(["SAIR", "sair", "Sair.", " sair! ", "PARAR", "parar"])("%s é descadastro", (t) => {
        expect(isOptOutText(t)).toBe(true);
    });
    it.each(["quero sair do grupo", "saia", "", "não quero parar de receber"])("%s não é descadastro", (t) => {
        expect(isOptOutText(t)).toBe(false);
    });
    it("reconhece VOLTAR", () => {
        expect(isOptInText("Voltar!")).toBe(true);
        expect(isOptInText("sair")).toBe(false);
    });
});

describe("phoneKey", () => {
    it("usa os últimos 8 dígitos, igualando com e sem o 9º dígito", () => {
        expect(phoneKey("5561999531848@s.whatsapp.net")).toBe(phoneKey("556199531848@s.whatsapp.net"));
        expect(phoneKey("5561999531848:7@s.whatsapp.net")).toBe("99531848");
    });
});

describe("withFooter", () => {
    it("acrescenta o aviso de descadastro", () => {
        expect(withFooter("Oi")).toBe(`Oi\n\n${OPTOUT_FOOTER}`);
        expect(withFooter("")).toBe(OPTOUT_FOOTER);
    });
});

describe("isOptedOut / addOptOut", () => {
    it("consulta pela chave do telefone e pela sessão", async () => {
        optOut.findUnique.mockResolvedValue({ id: 1 });
        expect(await isOptedOut("s1", "5561999531848@s.whatsapp.net")).toBe(true);
        expect(optOut.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { sessionId_phoneKey: { sessionId: "s1", phoneKey: "99531848" } } })
        );
    });
    it("número curto demais nunca é considerado descadastrado nem gravado", async () => {
        expect(await isOptedOut("s1", "123@s.whatsapp.net")).toBe(false);
        await addOptOut("s1", "123@s.whatsapp.net");
        expect(optOut.findUnique).not.toHaveBeenCalled();
        expect(optOut.upsert).not.toHaveBeenCalled();
    });
});
