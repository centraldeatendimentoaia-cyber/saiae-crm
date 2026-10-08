import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import type { IaContextoAtivo } from "./comanda-contexto";
import { criarChamadorDono, criarLiberador, MSG_IA_REATIVADA, PAUSA_HORAS, TEMPLATE_DONO } from "./dono";
import type { ConversaRef } from "./store";

const T0 = new Date("2026-10-08T12:00:00Z");
const DONO = "61988887777";
const CLIENTE = "5561999990001";

const ctx = (dono: string | null) =>
    ({ ativa: true, loja: { nome: "Açaí do Zé", link_cardapio: "https://x.com/c/ABC234" }, ia: { texto_livre: null, whatsapp_dono: dono, plano_limite_conversas: null } }) as unknown as IaContextoAtivo;
const conversa = (over: Partial<ConversaRef> = {}): ConversaRef => ({ id: "c1", lojaCodigo: "ABC234", contactKey: CLIENTE, estado: "ia", pausadaAte: null, ...over });

function chamador(enviar: () => Promise<unknown> = async () => ({})) {
    const enviarTemplate = vi.fn(enviar);
    const store = { pausar: vi.fn(async () => undefined) };
    const logger = { info: vi.fn(), warn: vi.fn() };
    return { chamar: criarChamadorDono({ enviarTemplate, store, now: () => T0, logger }), enviarTemplate, store, logger };
}

describe("chamar o responsável", () => {
    it("envia o template ao dono (telefone normalizado) e pausa por 12 h", async () => {
        const c = chamador();
        expect(await c.chamar(conversa(), ctx(DONO), "reclamacao")).toBe(true);
        expect(c.enviarTemplate).toHaveBeenCalledWith(`55${DONO}`, expect.objectContaining({ name: TEMPLATE_DONO, languageCode: "pt_BR", bodyParameters: ["Açaí do Zé", "reclamação", CLIENTE, "ABC234"] }));
        expect(c.store.pausar).toHaveBeenCalledWith("c1", new Date(T0.getTime() + PAUSA_HORAS * 3_600_000));
    });
    it("já pausada: não avisa de novo", async () => {
        const c = chamador();
        expect(await c.chamar(conversa({ estado: "humano", pausadaAte: new Date(T0.getTime() + 1000) }), ctx(DONO), "nao_sei")).toBe(true);
        expect(c.enviarTemplate).not.toHaveBeenCalled();
    });
    it("pausa vencida: avisa de novo", async () => {
        const c = chamador();
        await c.chamar(conversa({ estado: "humano", pausadaAte: new Date(T0.getTime() - 1000) }), ctx(DONO), "nao_sei");
        expect(c.enviarTemplate).toHaveBeenCalledTimes(1);
    });
    it.each([null, "", "123", "BR.abc"])("sem WhatsApp válido do responsável (%j): false e sem pausar", async (n) => {
        const c = chamador();
        expect(await c.chamar(conversa(), ctx(n), "nao_sei")).toBe(false);
        expect(c.enviarTemplate).not.toHaveBeenCalled();
        expect(c.store.pausar).not.toHaveBeenCalled();
    });
    it("falha no envio: false, não pausa e o log não vaza telefone nem texto do erro", async () => {
        const c = chamador(async () => {
            throw new Error(`falhou ${DONO} ${CLIENTE}`);
        });
        expect(await c.chamar(conversa(), ctx(DONO), "nao_sei")).toBe(false);
        expect(c.store.pausar).not.toHaveBeenCalled();
        const log = JSON.stringify([c.logger.info.mock.calls, c.logger.warn.mock.calls]);
        expect(log).not.toContain(DONO);
        expect(log).not.toContain(CLIENTE);
    });
});

describe("liberar", () => {
    const montar = (dono: string | null, ativa = true) => {
        const store = { retomarLoja: vi.fn(async () => 2) };
        const contexto = vi.fn(async () => (ativa ? ctx(dono) : ({ ativa: false } as const)));
        return { store, contexto, liberar: criarLiberador({ store, contexto, logger: { info: vi.fn() } }) };
    };
    it("do responsável cadastrado: devolve as conversas da loja", async () => {
        const l = montar(DONO);
        expect(await l.liberar("liberar #abc234", `55${DONO}`)).toBe(MSG_IA_REATIVADA);
        expect(l.contexto).toHaveBeenCalledWith("ABC234", `55${DONO}`);
        expect(l.store.retomarLoja).toHaveBeenCalledWith("ABC234");
    });
    it("de outro número: ignora (null) e não devolve nada", async () => {
        const l = montar(DONO);
        expect(await l.liberar("LIBERAR #ABC234", CLIENTE)).toBeNull();
        expect(l.store.retomarLoja).not.toHaveBeenCalled();
    });
    it("loja inativa ou texto qualquer: null", async () => {
        expect(await montar(DONO, false).liberar("LIBERAR #ABC234", `55${DONO}`)).toBeNull();
        const l = montar(DONO);
        expect(await l.liberar("oi, pode liberar?", `55${DONO}`)).toBeNull();
        expect(l.contexto).not.toHaveBeenCalled();
    });
});
