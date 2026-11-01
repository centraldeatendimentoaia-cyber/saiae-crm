import { beforeEach, describe, expect, it } from "vitest";
import { _zerarEnviados, foiRespondidaPorRegra, marcarRespondidaPorRegra } from "./enviados";

describe("respondida por regra de resposta automática", () => {
    beforeEach(() => _zerarEnviados());

    it("lembra o id marcado e não confunde com outros", () => {
        marcarRespondidaPorRegra("A", 1000);
        expect(foiRespondidaPorRegra("A", 2000)).toBe(true);
        expect(foiRespondidaPorRegra("B", 2000)).toBe(false);
    });
    it("esquece depois de 10 minutos", () => {
        marcarRespondidaPorRegra("A", 1000);
        expect(foiRespondidaPorRegra("A", 1000 + 10 * 60_000 + 1)).toBe(false);
    });
    it("id vazio nunca conta como respondido", () => {
        marcarRespondidaPorRegra(undefined);
        expect(foiRespondidaPorRegra(undefined)).toBe(false);
        expect(foiRespondidaPorRegra(null)).toBe(false);
    });
});
