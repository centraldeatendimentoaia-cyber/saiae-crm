import { describe, it, expect, vi } from "vitest";

vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import { logger } from "@/lib/logger";
import { numeroDeEnvioPertence, sessaoDaBarracaCloud, sessaoDoNumero } from "./cloud-sessao";

const DUAS = { WHATSAPP_CLOUD_SESSION_ID: "loja-a,loja-b" };
const MAPA = { ...DUAS, WHATSAPP_CLOUD_PHONE_MAP: JSON.stringify({ "111": "loja-a", "222": "loja-b" }) };

describe("sessaoDoNumero", () => {
    it("sem sessão Cloud listada: sem_sessao_cloud", () => {
        expect(sessaoDoNumero({}, "111")).toEqual({ ok: false, motivo: "sem_sessao_cloud" });
    });
    it("exatamente uma sessão e sem mapa: usa essa sessão (comportamento de sempre), com ou sem phoneNumberId", () => {
        expect(sessaoDoNumero({ WHATSAPP_CLOUD_SESSION_ID: "pilot" }, "999")).toEqual({ ok: true, sessionId: "pilot" });
        expect(sessaoDoNumero({ WHATSAPP_CLOUD_SESSION_ID: "pilot" }, null)).toEqual({ ok: true, sessionId: "pilot" });
    });
    it("várias sessões e sem mapa: ambígua (nunca a primeira)", () => {
        expect(sessaoDoNumero(DUAS, "111")).toEqual({ ok: false, motivo: "ambigua" });
    });
    it("várias sessões com mapa: cada número cai na própria sessão", () => {
        expect(sessaoDoNumero(MAPA, "111")).toEqual({ ok: true, sessionId: "loja-a" });
        expect(sessaoDoNumero(MAPA, "222")).toEqual({ ok: true, sessionId: "loja-b" });
    });
    it("número fora do mapa, ou mapa para sessão que não é Cloud: falha", () => {
        expect(sessaoDoNumero(MAPA, "333")).toEqual({ ok: false, motivo: "ambigua" });
        expect(sessaoDoNumero({ ...DUAS, WHATSAPP_CLOUD_PHONE_MAP: '{"111":"outra"}' }, "111")).toEqual({ ok: false, motivo: "sem_correspondencia" });
    });
    it("uma sessão com mapa: número desconhecido não cai na sessão única", () => {
        expect(sessaoDoNumero({ WHATSAPP_CLOUD_SESSION_ID: "a", WHATSAPP_CLOUD_PHONE_MAP: '{"111":"a"}' }, "999")).toEqual({ ok: false, motivo: "sem_correspondencia" });
    });
    it("mapa com JSON quebrado: com várias sessões falha fechado", () => {
        expect(sessaoDoNumero({ ...DUAS, WHATSAPP_CLOUD_PHONE_MAP: "{x" }, "111")).toEqual({ ok: false, motivo: "ambigua" });
    });
});

describe("mapa com chaves e valores com espaços / JSON quebrado", () => {
    it("aplica trim nas chaves e nos valores", () => {
        expect(sessaoDoNumero({ ...DUAS, WHATSAPP_CLOUD_PHONE_MAP: '{" 111 ":" loja-a "}' }, "111")).toEqual({ ok: true, sessionId: "loja-a" });
    });
    it("JSON quebrado: avisa uma única vez", () => {
        const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
        const env = { ...DUAS, WHATSAPP_CLOUD_BARRACA_MAP: "{quebrado" };
        sessaoDaBarracaCloud(env, "b1");
        sessaoDaBarracaCloud(env, "b2");
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});

describe("sessaoDaBarracaCloud", () => {
    it("cada barraca na própria sessão; barraca fora do mapa falha", () => {
        const env = { ...DUAS, WHATSAPP_CLOUD_BARRACA_MAP: JSON.stringify({ b1: "loja-a", b2: "loja-b" }) };
        expect(sessaoDaBarracaCloud(env, "b1")).toEqual({ ok: true, sessionId: "loja-a" });
        expect(sessaoDaBarracaCloud(env, "b2")).toEqual({ ok: true, sessionId: "loja-b" });
        expect(sessaoDaBarracaCloud(env, "b3")).toEqual({ ok: false, motivo: "ambigua" });
    });
});

describe("numeroDeEnvioPertence", () => {
    it("uma sessão: sempre verdadeiro", () => {
        expect(numeroDeEnvioPertence({ WHATSAPP_CLOUD_SESSION_ID: "pilot" }, "pilot")).toBe(true);
    });
    it("várias: só se o número de envio mapeia para a sessão esperada", () => {
        expect(numeroDeEnvioPertence({ ...MAPA, META_WA_PHONE_NUMBER_ID: "111" }, "loja-a")).toBe(true);
        expect(numeroDeEnvioPertence({ ...MAPA, META_WA_PHONE_NUMBER_ID: "111" }, "loja-b")).toBe(false);
        expect(numeroDeEnvioPertence(MAPA, "loja-a")).toBe(false);
    });
});
