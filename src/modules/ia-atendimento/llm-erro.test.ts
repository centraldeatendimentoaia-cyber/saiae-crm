import { describe, it, expect } from "vitest";
import { descreverErro } from "./llm";
import { jidsDaConversa } from "../agente-salao/conversas-admin";

describe("descreverErro", () => {
    it("mostra tipo, status e a causa informada pela API (modelo, chave, crédito)", () => {
        const e = { name: "NotFoundError", status: 404, error: { error: { type: "not_found_error", message: "model: claude-x" } } };
        expect(descreverErro(e)).toBe('NotFoundError status=404 api=not_found_error msg="model: claude-x"');
    });
    it("queda de conexão mostra o código de rede", () => {
        expect(descreverErro({ name: "APIConnectionError", cause: { code: "ECONNRESET" } })).toBe("APIConnectionError rede=ECONNRESET");
    });
    it("valor estranho não lança", () => {
        expect(descreverErro(null)).toBe("erro");
        expect(descreverErro("x")).toBe("erro");
    });
});

describe("jidsDaConversa", () => {
    it("junta o chat em LID com o telefone e as variantes do 9º dígito", () => {
        const jids = jidsDaConversa({ jid: "123@lid", telefone: "5561999990000" });
        expect(jids).toEqual(expect.arrayContaining(["123@lid", "5561999990000@s.whatsapp.net", "556199990000@s.whatsapp.net"]));
    });
    it("sem telefone usa só o próprio chat", () => {
        expect(jidsDaConversa({ jid: "123@lid", telefone: null })).toEqual(["123@lid"]);
    });
});
