import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BoundedTtlMap, isStale, markSeen, recordSequence, resetEventState, sequenceKey, wasSeen } from "./state";
import { loadSecrets } from "./secrets";
import { parseTimestamp, timestampInWindow, verifyComandaSignature } from "./signature";
import crypto from "crypto";

describe("BoundedTtlMap", () => {
    it("guarda e devolve, e expira depois do TTL", () => {
        let t = 1000;
        const m = new BoundedTtlMap<number>(10, 100, () => t);
        m.set("a", 1);
        expect(m.get("a")).toBe(1);
        t = 1099;
        expect(m.get("a")).toBe(1);
        t = 1100;
        expect(m.get("a")).toBeUndefined();
        expect(m.size).toBe(0);
    });
    it("é limitado: descarta os mais antigos (não cresce sem fim)", () => {
        const m = new BoundedTtlMap<number>(3, 10_000);
        for (let i = 1; i <= 5; i++) m.set(`k${i}`, i);
        expect(m.size).toBe(3);
        expect(m.has("k1")).toBe(false);
        expect(m.has("k2")).toBe(false);
        expect(m.has("k5")).toBe(true);
    });
    it("regravar uma chave a torna a mais nova", () => {
        const m = new BoundedTtlMap<number>(2, 10_000);
        m.set("a", 1);
        m.set("b", 2);
        m.set("a", 3);
        m.set("c", 4);
        expect(m.has("a")).toBe(true);
        expect(m.has("b")).toBe(false);
    });
});

describe("estado de idempotência e ordem", () => {
    beforeEach(resetEventState);
    it("ids vistos e sequence máxima por chave", () => {
        expect(wasSeen("x")).toBe(false);
        markSeen("x");
        expect(wasSeen("x")).toBe(true);
        const k = sequenceKey("b", "p");
        expect(isStale(k, 1)).toBe(false);
        recordSequence(k, 5);
        recordSequence(k, 3); // não diminui
        expect(isStale(k, 4)).toBe(true);
        expect(isStale(k, 5)).toBe(false);
        expect(isStale(k, 6)).toBe(false);
    });
    it("resetEventState zera tudo (como um reinício do processo: a idempotência não sobrevive a ele)", () => {
        markSeen("x");
        recordSequence("k", 9);
        resetEventState();
        expect(wasSeen("x")).toBe(false);
        expect(isStale("k", 1)).toBe(false);
    });
});

describe("loadSecrets", () => {
    const S1 = "segredo-numero-um-com-16-chars+";
    it("lê texto e lista de segredos por barraca", () => {
        const m = loadSecrets({ COMANDA_WEBHOOK_SECRETS: JSON.stringify({ a: S1, b: [S1, S1 + "2"] }) })!;
        expect(m.get("a")).toEqual([S1]);
        expect(m.get("b")).toEqual([S1, S1 + "2"]);
    });
    it.each([undefined, "", "  ", "nao-json", "[]", "null", "{}", JSON.stringify({ a: "curto" }), JSON.stringify({ a: 123 })])("%j: null", (v) => {
        expect(loadSecrets({ COMANDA_WEBHOOK_SECRETS: v })).toBeNull();
    });
    it("descarta só a barraca inválida e mantém as boas", () => {
        const m = loadSecrets({ COMANDA_WEBHOOK_SECRETS: JSON.stringify({ ruim: "x", boa: S1 }) })!;
        expect([...m.keys()]).toEqual(["boa"]);
    });
    it("chave perigosa __proto__ não vira barraca com protótipo", () => {
        const m = loadSecrets({ COMANDA_WEBHOOK_SECRETS: '{"__proto__":"' + S1 + '","ok":"' + S1 + '"}' })!;
        expect(m.get("toString")).toBeUndefined();
    });
});

describe("signature", () => {
    afterEach(() => vi.useRealTimers());
    it("parseTimestamp aceita só dígitos", () => {
        expect(parseTimestamp("1749416383")).toBe(1749416383);
        for (const bad of [null, "", "abc", "-1", "1.5", "1e9", "1749416383123456789"]) expect(parseTimestamp(bad), String(bad)).toBeNull();
    });
    it("timestampInWindow: ±300 s, com o relógio injetado", () => {
        const now = 1_750_000_000_000;
        expect(timestampInWindow(1_750_000_000, now)).toBe(true);
        expect(timestampInWindow(1_750_000_000 - 300, now)).toBe(true);
        expect(timestampInWindow(1_750_000_000 - 301, now)).toBe(false);
        expect(timestampInWindow(1_750_000_000 + 301, now)).toBe(false);
    });
    it("verifyComandaSignature: HMAC de timestamp + '.' + corpo bruto, em bytes", () => {
        const body = Buffer.from('{"emoji":"🍇","nome":"Açaí"}', "utf8");
        const secret = "segredo-de-teste-com-mais-de-16";
        const sig = "sha256=" + crypto.createHmac("sha256", secret).update(Buffer.concat([Buffer.from("123."), body])).digest("hex");
        expect(verifyComandaSignature(body, "123", sig, [secret])).toBe(true);
        expect(verifyComandaSignature(body, "124", sig, [secret])).toBe(false);
        expect(verifyComandaSignature(Buffer.from("x"), "123", sig, [secret])).toBe(false);
        expect(verifyComandaSignature(body, "123", sig, [])).toBe(false);
        expect(verifyComandaSignature(body, "123", null, [secret])).toBe(false);
        expect(verifyComandaSignature(body, "123", sig.toUpperCase().replace("SHA256=", "sha256="), [secret])).toBe(true); // hex em maiúsculas
    });
});
