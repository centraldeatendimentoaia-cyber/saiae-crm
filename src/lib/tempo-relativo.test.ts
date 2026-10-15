import { describe, it, expect } from "vitest";
import { tempoRelativo } from "./tempo-relativo";

const agora = new Date("2026-10-15T12:00:00Z").getTime();
const antes = (segundos: number) => new Date(agora - segundos * 1000);

describe("tempoRelativo", () => {
    it("diz 'agora' para menos de 45 segundos", () => {
        expect(tempoRelativo(antes(10), agora)).toBe("agora");
    });

    it("escreve em português, no passado", () => {
        expect(tempoRelativo(antes(5 * 60), agora)).toBe("há 5 minutos");
        expect(tempoRelativo(antes(3 * 3600), agora)).toBe("há 3 horas");
        expect(tempoRelativo(antes(2 * 86400), agora)).toBe("anteontem");
        expect(tempoRelativo(antes(10 * 86400), agora)).toBe("há 10 dias");
    });

    it("aceita string ISO e devolve vazio para data inválida", () => {
        expect(tempoRelativo(antes(3600).toISOString(), agora)).toBe("há 1 hora");
        expect(tempoRelativo("lixo", agora)).toBe("");
    });
});
