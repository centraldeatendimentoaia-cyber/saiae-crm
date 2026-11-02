import { describe, it, expect } from "vitest";
import { telefoneComDdi, jidDoTelefone } from "./telefone-br";

describe("telefoneComDdi", () => {
    it("DDD + celular ganha o 55", () => expect(telefoneComDdi("(61) 99999-0000")).toBe("5561999990000"));
    it("zero na frente é descartado (nunca vira DDI de outro país)", () => expect(telefoneComDdi("061999990000")).toBe("5561999990000"));
    it("número que já tem DDI não muda", () => expect(telefoneComDdi("+55 61 99999-0000")).toBe("5561999990000"));
    it("DDD + fixo (10 dígitos) ganha o 55", () => expect(telefoneComDdi("6133334444")).toBe("556133334444"));
});

describe("jidDoTelefone", () => {
    it("monta o JID de conversa individual", () => expect(jidDoTelefone("61 99999-0000")).toBe("5561999990000@s.whatsapp.net"));
});
