import { describe, it, expect } from "vitest";
import { quemPodeEnviar } from "./precedencia";

const agora = new Date("2026-10-08T12:00:00Z");
const mais = (h: number) => new Date(agora.getTime() + h * 3_600_000);

describe("quemPodeEnviar", () => {
    it("conversa em estado ia: a IA envia, nada a retomar", () => {
        expect(quemPodeEnviar({ estado: "ia", pausadaAte: null }, agora)).toEqual({ pode: true, retomar: false });
    });
    it("pessoa assumiu e a pausa ainda vale: a IA e a automação não enviam", () => {
        expect(quemPodeEnviar({ estado: "humano", pausadaAte: mais(1) }, agora)).toEqual({ pode: false, motivo: "humano_assumiu" });
    });
    it("pausa vencida: a IA pode enviar e deve retomar", () => {
        expect(quemPodeEnviar({ estado: "humano", pausadaAte: mais(-1) }, agora)).toEqual({ pode: true, retomar: true });
        expect(quemPodeEnviar({ estado: "humano", pausadaAte: null }, agora)).toEqual({ pode: true, retomar: true });
    });
});
