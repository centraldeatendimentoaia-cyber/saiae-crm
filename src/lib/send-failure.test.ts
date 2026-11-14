import { describe, it, expect } from "vitest";
import { CloudApiError } from "@/modules/whatsapp/cloud/errors";
import { classifySendFailure, backoffMs, MAX_ATTEMPTS } from "./send-failure";

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
    ])("%s => %s", (err, esperado) => {
        expect(classifySendFailure(err)).toBe(esperado);
    });

    it("backoff cresce e é limitado", () => {
        expect(backoffMs(1)).toBeLessThan(backoffMs(2));
        expect(backoffMs(2)).toBeLessThan(backoffMs(3));
        expect(backoffMs(99)).toBe(backoffMs(3));
        expect(MAX_ATTEMPTS).toBe(4);
    });
});
