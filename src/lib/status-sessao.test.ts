import { describe, it, expect } from "vitest";
import { rotuloStatusSessao } from "./status-sessao";

describe("rotuloStatusSessao", () => {
    it("traduz os status conhecidos", () => {
        expect(rotuloStatusSessao("CONNECTED")).toBe("Conectada");
        expect(rotuloStatusSessao("DISCONNECTED")).toBe("Desconectada");
        expect(rotuloStatusSessao("ZOMBIE")).toBe("Sem resposta");
    });
    it("devolve o valor original quando não conhece o status", () => {
        expect(rotuloStatusSessao("QR_READY")).toBe("QR_READY");
    });
});
