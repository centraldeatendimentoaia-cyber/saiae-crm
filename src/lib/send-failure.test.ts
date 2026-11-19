import { describe, it, expect } from "vitest";
import { CloudApiError } from "@/modules/whatsapp/cloud/errors";
import { classifySendFailure, backoffMs, maskPersonalData, MAX_ATTEMPTS } from "./send-failure";

describe("classifySendFailure", () => {
    it.each([
        [new CloudApiError("rate_limit", "x"), "transient"],
        [new CloudApiError("window_closed", "x"), "policy"],
        [new CloudApiError("template", "x"), "policy"],
        [new CloudApiError("network", "x"), "unknown"],
        [new CloudApiError("server", "x"), "unknown"],
        [new CloudApiError("unexpected_response", "x"), "unknown"],
        [new CloudApiError("auth", "x"), "permanent"],
        [new CloudApiError("undeliverable", "x"), "permanent"],
        [new CloudApiError("invalid_request", "x"), "permanent"],
        [new Error("Timed Out"), "unknown"],
        [new Error("Connection Closed"), "unknown"],
        [Object.assign(new Error("x"), { name: "AbortError" }), "unknown"],
        [new Error("Descadastrado (respondeu SAIR)"), "policy"],
        [new Error("Sem conversa anterior (modo: só quem já interagiu)"), "policy"],
        [new Error("Número não possui WhatsApp"), "permanent"],
        [new Error("falha qualquer"), "transient"],
        [new Error("Stream Errored (unknown)"), "unknown"],
        [new Error("Connection Failure"), "unknown"],
        [new Error("Socket closed"), "unknown"],
        [new Error("Socket not open"), "unknown"],
        [new Error("WebSocket is not open: readyState 3"), "unknown"],
        [new Error("Stream Errored (restart required)"), "unknown"],
        [new Error("restartRequired"), "unknown"],
        [new Error("Template obrigatório fora da janela"), "policy"],
        [new Error("template required"), "policy"],
        [new Error("falha ao carregar template de texto"), "transient"],
    ])("%s => %s", (err, esperado) => {
        expect(classifySendFailure(err)).toBe(esperado);
    });

    it("depois de chamar o provedor, erro comum de Baileys sem padrão conhecido é unknown; antes do envio segue transient", () => {
        expect(classifySendFailure(new Error("falha qualquer"), { sendAttempted: true })).toBe("unknown");
        expect(classifySendFailure(new Error("falha qualquer"), { sendAttempted: false })).toBe("transient");
        expect(classifySendFailure(new CloudApiError("rate_limit", "x"), { sendAttempted: true })).toBe("transient");
        expect(classifySendFailure(new Error("Número não possui WhatsApp"), { sendAttempted: true })).toBe("permanent");
        expect(classifySendFailure(new Error("Descadastrado (respondeu SAIR)"), { sendAttempted: true })).toBe("policy");
    });

    it("backoff cresce e é limitado", () => {
        expect(backoffMs(1)).toBeLessThan(backoffMs(2));
        expect(backoffMs(2)).toBeLessThan(backoffMs(3));
        expect(backoffMs(99)).toBe(backoffMs(3));
        expect(MAX_ATTEMPTS).toBe(4);
    });
});

describe("maskPersonalData", () => {
    it("mascara telefone, JID e LID, mantendo o resto do texto", () => {
        const m = maskPersonalData("falha 5561999531848@s.whatsapp.net e 123456789012345:7@lid, tel 61999531848 ok 1234567");
        expect(m).not.toMatch(/\d{8,}|@s\.whatsapp\.net|@lid/);
        expect(m).toContain("falha");
        expect(m).toContain("1234567"); // menos de 8 dígitos não é telefone
    });
});
