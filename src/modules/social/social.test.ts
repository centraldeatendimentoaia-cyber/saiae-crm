import { describe, it, expect, vi, afterEach } from "vitest";
import { encryptToken, decryptToken } from "./crypto";
import { parsePostInput } from "./validate";
import { publishInstagram, publishFacebook, discoverAccounts, GraphError } from "./graph";

process.env.SOCIAL_TOKEN_KEY = "chave-de-teste";
const now = new Date("2026-10-14T12:00:00Z");
const ok = (type: string, extra: object = {}) => ({ type, mediaIds: ["a"], publishAt: "2026-10-14T15:00:00Z", accountId: "x", ...extra });

describe("crypto", () => {
    it("ida e volta, e cifra diferente a cada vez", () => {
        const a = encryptToken("EAAB123"), b = encryptToken("EAAB123");
        expect(a).not.toBe(b);
        expect(a).not.toContain("EAAB123");
        expect(decryptToken(a)).toBe("EAAB123");
    });
    it("adulterado falha", () => {
        const [iv, tag, data] = encryptToken("segredo").split(".");
        expect(() => decryptToken([iv, tag, Buffer.from("x").toString("base64") + data].join("."))).toThrow();
    });
});

describe("parsePostInput", () => {
    it("aceita feed e story válidos", () => {
        expect("value" in parsePostInput(ok("FEED", { caption: " oi " }), "instagram", now)).toBe(true);
        const s = parsePostInput(ok("STORY", { caption: "ignorada" }), "instagram", now);
        expect("value" in s && s.value.caption).toBe("");
    });
    it("rejeita casos inválidos", () => {
        expect(parsePostInput(ok("REEL"), "instagram", now)).toHaveProperty("error");
        expect(parsePostInput(ok("FEED", { mediaIds: [] }), "instagram", now)).toHaveProperty("error");
        expect(parsePostInput(ok("STORY", { mediaIds: ["a", "b"] }), "instagram", now)).toHaveProperty("error");
        expect(parsePostInput(ok("FEED", { mediaIds: ["a", "a"] }), "instagram", now)).toHaveProperty("error");
        expect(parsePostInput(ok("FEED", { caption: "x".repeat(2201) }), "instagram", now)).toHaveProperty("error");
        expect(parsePostInput(ok("FEED", { publishAt: "2026-10-14T11:00:00Z" }), "instagram", now)).toHaveProperty("error");
        expect(parsePostInput(ok("FEED", { publishAt: "lixo" }), "instagram", now)).toHaveProperty("error");
    });
    it("permite 'agora' (até 5 min atrás)", () => {
        expect("value" in parsePostInput(ok("FEED", { publishAt: "2026-10-14T11:57:00Z" }), "instagram", now)).toBe(true);
    });
});

describe("graph", () => {
    afterEach(() => vi.unstubAllGlobals());

    const mockFetch = (handler: (url: string, body?: URLSearchParams) => unknown) => {
        const calls: { url: string; body?: URLSearchParams }[] = [];
        vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
            const body = init?.body as URLSearchParams | undefined;
            calls.push({ url, body });
            const json: any = handler(url, body);
            return { ok: !json?.error, status: json?.error ? 400 : 200, json: async () => json };
        }));
        return calls;
    };

    it("story do Instagram: container STORIES → status → publish, token no corpo", async () => {
        const calls = mockFetch((url) => {
            if (url.endsWith("/IG/media")) return { id: "C1" };
            if (url.includes("/C1?")) return { status_code: "FINISHED" };
            if (url.endsWith("/IG/media_publish")) return { id: "M1" };
            return { permalink: "https://instagram.com/p/x" };
        });
        const r = await publishInstagram({ igId: "IG", token: "TOK", type: "STORY", imageUrls: ["https://x/1.jpg"] });
        expect(r).toEqual({ id: "M1", url: "https://instagram.com/p/x" });
        expect(calls[0].body?.get("media_type")).toBe("STORIES");
        expect(calls[0].body?.get("access_token")).toBe("TOK");
        expect(calls.every((c) => !c.url.includes("TOK") || c.url.includes("?"))).toBe(true);
        expect(calls[0].url).not.toContain("TOK");
    });

    it("carrossel monta children na ordem", async () => {
        let n = 0;
        const calls = mockFetch((url, body) => {
            if (url.endsWith("/IG/media")) return { id: body?.get("media_type") === "CAROUSEL" ? "CAR" : `K${++n}` };
            if (url.includes("?")) return { status_code: "FINISHED" };
            return { id: "M2" };
        });
        await publishInstagram({ igId: "IG", token: "T", type: "FEED", imageUrls: ["a", "b"], caption: "oi" });
        const car = calls.find((c) => c.body?.get("media_type") === "CAROUSEL")!;
        expect(car.body?.get("children")).toBe("K1,K2");
        expect(car.body?.get("caption")).toBe("oi");
    });

    it("erro da Meta vira GraphError e pede reconexão no code 190", async () => {
        mockFetch(() => ({ error: { message: "Token expirado", code: 190 } }));
        const err = await publishFacebook({ pageId: "P", token: "T", type: "FEED", imageUrls: ["a"] }).catch((e) => e);
        expect(err).toBeInstanceOf(GraphError);
        expect(err.needsReconnect).toBe(true);
    });

    it("story do Facebook usa foto não publicada + photo_stories", async () => {
        const calls = mockFetch((url) => (url.endsWith("/photos") ? { id: "PH" } : { success: true, post_id: "S1" }));
        const r = await publishFacebook({ pageId: "P", token: "T", type: "STORY", imageUrls: ["a"] });
        expect(r.id).toBe("S1");
        expect(calls[0].body?.get("published")).toBe("false");
        expect(calls[1].body?.get("photo_id")).toBe("PH");
    });

    it("discoverAccounts devolve página + instagram ligado", async () => {
        mockFetch(() => ({ data: [{ id: "P1", name: "Salão", access_token: "PT", instagram_business_account: { id: "I1", username: "salao" } }] }));
        const a = await discoverAccounts("UT");
        expect(a.map((x) => [x.provider, x.externalId, x.pageId])).toEqual([["facebook", "P1", "P1"], ["instagram", "I1", "P1"]]);
    });
});
