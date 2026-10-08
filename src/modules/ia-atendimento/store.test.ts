import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    prisma: {
        iaMensagem: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn() },
        iaConversa: { upsert: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import { prismaStore, IaWindowStore, limparMensagensAntigas, RETENCAO_DIAS, SEM_LOJA } from "./store";
import { extrairCodigoLoja, ehCodigoLojaValido } from "./loja";

const conversa = { id: "c1", lojaCodigo: "K7P2QX", contactKey: "5561999990001", estado: "ia", pausadaAte: null, ultimaMensagemEm: new Date("2026-10-08T10:00:00Z") };
const reg = { lojaCodigo: "K7P2QX", contactKey: "5561999990001", providerMessageId: "wamid.1", texto: "oi", direcao: "in" as const, em: new Date("2026-10-08T12:00:00Z") };

beforeEach(() => {
    Object.values(h.prisma).forEach((m) => Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset()));
    h.prisma.iaMensagem.findUnique.mockResolvedValue(null);
    h.prisma.iaConversa.upsert.mockResolvedValue(conversa);
    h.prisma.iaMensagem.create.mockResolvedValue({});
    h.prisma.iaConversa.update.mockResolvedValue({});
});

describe("registrarMensagem (idempotência)", () => {
    it("mensagem nova: cria a conversa se preciso, grava e atualiza a última mensagem", async () => {
        const r = await prismaStore.registrarMensagem(reg);
        expect(r.novo).toBe(true);
        expect(r.conversa).toMatchObject({ id: "c1", lojaCodigo: "K7P2QX", estado: "ia" });
        expect(h.prisma.iaConversa.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { lojaCodigo_contactKey: { lojaCodigo: "K7P2QX", contactKey: "5561999990001" } } }));
        expect(h.prisma.iaMensagem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversaId: "c1", providerMessageId: "wamid.1", direcao: "in", texto: "oi" }) });
        expect(h.prisma.iaConversa.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { ultimaMensagemEm: reg.em } });
    });
    it("mesmo providerMessageId já gravado: novo=false e NÃO grava de novo", async () => {
        h.prisma.iaMensagem.findUnique.mockResolvedValue({ conversa });
        const r = await prismaStore.registrarMensagem(reg);
        expect(r.novo).toBe(false);
        expect(h.prisma.iaMensagem.create).not.toHaveBeenCalled();
        expect(h.prisma.iaConversa.upsert).not.toHaveBeenCalled();
    });
    it("corrida: a violação de unicidade (P2002) do banco vira novo=false", async () => {
        h.prisma.iaMensagem.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
        const r = await prismaStore.registrarMensagem(reg);
        expect(r.novo).toBe(false);
    });
    it("outro erro do banco sobe (não é engolido)", async () => {
        h.prisma.iaMensagem.create.mockRejectedValue(new Error("db fora"));
        await expect(prismaStore.registrarMensagem(reg)).rejects.toThrow("db fora");
    });
    it("mensagem de saída não mexe na última mensagem recebida", async () => {
        await prismaStore.registrarMensagem({ ...reg, direcao: "out" });
        expect(h.prisma.iaConversa.update).not.toHaveBeenCalled();
    });
    it("mensagem mais ANTIGA que a última (fora de ordem) não recua a data", async () => {
        await prismaStore.registrarMensagem({ ...reg, em: new Date("2026-10-08T09:00:00Z") });
        expect(h.prisma.iaConversa.update).not.toHaveBeenCalled();
    });
});

describe("lojaDaConversa", () => {
    it("devolve a loja da conversa mais recente e NUNCA a conversa 'sem loja'", async () => {
        h.prisma.iaConversa.findFirst.mockResolvedValue({ lojaCodigo: "K7P2QX" });
        expect(await prismaStore.lojaDaConversa("5561999990001")).toBe("K7P2QX");
        expect(h.prisma.iaConversa.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { contactKey: "5561999990001", lojaCodigo: { not: SEM_LOJA } }, orderBy: { ultimaMensagemEm: "desc" },
        }));
    });
    it("cliente que nunca falou com a IA: null", async () => {
        h.prisma.iaConversa.findFirst.mockResolvedValue(null);
        expect(await prismaStore.lojaDaConversa("5561999990001")).toBeNull();
    });
});

describe("historico", () => {
    it("devolve em ordem cronológica e limita a quantidade", async () => {
        h.prisma.iaMensagem.findMany.mockResolvedValue([{ direcao: "out", texto: "b" }, { direcao: "in", texto: "a" }]);
        expect(await prismaStore.historico("c1", 12)).toEqual([{ direcao: "in", texto: "a" }, { direcao: "out", texto: "b" }]);
        expect(h.prisma.iaMensagem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { conversaId: "c1" }, take: 12, orderBy: { criadoEm: "desc" } }));
    });
});

describe("IaWindowStore (janela de 24 h)", () => {
    it("usa a última mensagem RECEBIDA do cliente, de qualquer loja", async () => {
        const quando = new Date("2026-10-08T11:00:00Z");
        h.prisma.iaMensagem.findFirst.mockResolvedValue({ criadoEm: quando });
        expect(await new IaWindowStore().lastInboundAt("pilot", "5561999990001")).toEqual(quando);
        expect(h.prisma.iaMensagem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { direcao: "in", conversa: { contactKey: "5561999990001" } }, orderBy: { criadoEm: "desc" },
        }));
    });
    it("cliente que nunca escreveu: null (janela fechada)", async () => {
        h.prisma.iaMensagem.findFirst.mockResolvedValue(null);
        expect(await new IaWindowStore().lastInboundAt("pilot", "x")).toBeNull();
    });
});

describe("retenção de 30 dias", () => {
    it("apaga mensagens mais antigas que 30 dias e devolve a contagem", async () => {
        h.prisma.iaMensagem.deleteMany.mockResolvedValue({ count: 7 });
        const agora = new Date("2026-10-08T12:00:00Z");
        expect(await limparMensagensAntigas(RETENCAO_DIAS, agora)).toBe(7);
        const corte = h.prisma.iaMensagem.deleteMany.mock.calls[0][0].where.criadoEm.lt as Date;
        expect(corte.toISOString()).toBe(new Date(agora.getTime() - 30 * 86_400_000).toISOString());
    });
    it("a retenção padrão é de 30 dias", () => {
        expect(RETENCAO_DIAS).toBe(30);
    });
});

describe("código da loja", () => {
    it.each([
        ["oi #K7P2QX", "K7P2QX"],
        ["#k7p2qx vim pelo link", "K7P2QX"],
        ["texto antes #K7P2QX e depois", "K7P2QX"],
        ["Quero pedir!\n#K7P2QX", "K7P2QX"],
    ])("%j → %s", (texto, esperado) => expect(extrairCodigoLoja(texto)).toBe(esperado));
    it.each(["", "sem código", "#K7P2Q", "#K7P2QXY", "#K70P2Q", "#KIP2QX", "K7P2QX", "#K7P2-X", null, undefined])("%j → null", (texto) => {
        expect(extrairCodigoLoja(texto as string)).toBeNull();
    });
    it("ehCodigoLojaValido segue o mesmo alfabeto", () => {
        expect(ehCodigoLojaValido("K7P2QX")).toBe(true);
        expect(ehCodigoLojaValido("K70P2Q")).toBe(false);
        expect(ehCodigoLojaValido("k7p2qx")).toBe(false);
    });
});
