import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ prisma: { iaLead: { upsert: vi.fn(), deleteMany: vi.fn() } } }));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import { limparLeadsAntigos, prismaLeads, RETENCAO_LEAD_MESES } from "./lead-store";

beforeEach(() => {
    h.prisma.iaLead.upsert.mockReset().mockResolvedValue({});
    h.prisma.iaLead.deleteMany.mockReset().mockResolvedValue({ count: 3 });
});

describe("retenção do lead", () => {
    it("apaga leads sem contato há 12 meses e devolve a contagem", async () => {
        const agora = new Date("2026-10-09T12:00:00Z");
        expect(RETENCAO_LEAD_MESES).toBe(12);
        expect(await limparLeadsAntigos(12, agora)).toBe(3);
        const corte = h.prisma.iaLead.deleteMany.mock.calls[0][0].where.atualizadoEm.lt as Date;
        expect(corte.getFullYear()).toBe(2025);
        expect(corte.getMonth()).toBe(agora.getMonth());
    });
    it("cada contato renova o prazo (garantir atualiza atualizadoEm)", async () => {
        await prismaLeads.garantir("5561999990001", "outro");
        const arg = h.prisma.iaLead.upsert.mock.calls[0][0];
        expect(arg.update.atualizadoEm).toBeInstanceOf(Date);
        expect(arg.update.origem).toBeUndefined();
        await prismaLeads.garantir("5561999990001", "panfleto");
        expect(h.prisma.iaLead.upsert.mock.calls[1][0].update.origem).toBe("panfleto");
    });
});
