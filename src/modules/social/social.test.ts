import { describe, it, expect, vi, afterEach } from "vitest";
import { encryptToken, decryptToken } from "./crypto";
import { parseNewPost, parsePostingTimes, isHexColor } from "./validate";
import { publishInstagram, publishFacebook, discoverAccounts, pagesWithoutInstagram, GraphError } from "./graph";

process.env.SOCIAL_TOKEN_KEY = "chave-de-teste";
const now = new Date("2026-10-14T12:00:00Z");

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

describe("parseNewPost", () => {
    const base = { accountIds: ["x"], type: "FEED", mediaIds: ["a"], caption: "oi", dates: ["2026-10-14T15:00:00Z"] };
    const run = (extra: object = {}, prov: ("instagram" | "facebook")[] = ["instagram"]) => parseNewPost({ ...base, ...extra }, prov, now);

    it("aceita feed e story válidos (story ignora legenda)", () => {
        expect(run()).toHaveProperty("value");
        const s = run({ type: "STORY", caption: "ignorada" });
        expect("value" in s && s.value.caption).toBe("");
    });
    it("aceita o formato antigo (accountId + publishAt)", () => {
        const r = parseNewPost({ accountId: "x", type: "FEED", mediaIds: ["a"], publishAt: "2026-10-14T15:00:00Z" }, ["instagram"], now);
        expect("value" in r && r.value.accountIds).toEqual(["x"]);
    });
    it("várias datas e várias contas", () => {
        const r = run({ accountIds: ["x", "y"], dates: ["2026-10-14T15:00:00Z", "2026-10-21T15:00:00Z"] }, ["instagram", "facebook"]);
        expect("value" in r && r.value.dates.length).toBe(2);
    });
    it("rascunho não exige data", () => {
        const r = run({ draft: true, dates: [] });
        expect("value" in r && r.value.draft && r.value.dates).toEqual([]);
    });
    it("rejeita casos inválidos", () => {
        expect(run({ type: "REEL" })).toHaveProperty("error");
        expect(run({ mediaIds: [] })).toHaveProperty("error");
        expect(run({ type: "STORY", mediaIds: ["a", "b"] })).toHaveProperty("error");
        expect(run({ mediaIds: ["a", "a"] })).toHaveProperty("error");
        expect(run({ caption: "x".repeat(2201) })).toHaveProperty("error");
        expect(run({ accountIds: [] })).toHaveProperty("error");
        expect(run({ accountIds: ["x", "x"] })).toHaveProperty("error");
        expect(run({ dates: [] })).toHaveProperty("error");
        expect(run({ dates: ["2026-10-14T11:00:00Z"] })).toHaveProperty("error");
        expect(run({ dates: ["lixo"] })).toHaveProperty("error");
        expect(run({ dates: ["2026-10-14T15:00:00Z", "2026-10-14T15:00:00Z"] })).toHaveProperty("error");
        expect(run({ dates: Array.from({ length: 61 }, (_, i) => new Date(now.getTime() + (i + 1) * 3600_000).toISOString()) })).toHaveProperty("error");
    });
    it("legenda longa vale para o Facebook mas não para quem inclui Instagram", () => {
        expect(run({ caption: "x".repeat(3000) }, ["facebook"])).toHaveProperty("value");
        expect(run({ caption: "x".repeat(3000), accountIds: ["x", "y"] }, ["facebook", "instagram"])).toHaveProperty("error");
    });
    it("permite postar agora (até 5 min atrás)", () => {
        expect(run({ dates: ["2026-10-14T11:57:00Z"] })).toHaveProperty("value");
    });
});

describe("horários sugeridos e cor", () => {
    it("ordena, tira repetidos e valida HH:MM", () => {
        expect(parsePostingTimes(["19:00", "09:00", "09:00"])).toEqual({ value: ["09:00", "19:00"] });
        expect(parsePostingTimes(["9:00"])).toHaveProperty("error");
        expect(parsePostingTimes(["25:00"])).toHaveProperty("error");
        expect(parsePostingTimes("x")).toHaveProperty("error");
        expect(parsePostingTimes(Array.from({ length: 9 }, (_, i) => "0" + i + ":00"))).toHaveProperty("error");
    });
    it("cor hexadecimal", () => {
        expect(isHexColor("#a1B2c3")).toBe(true);
        expect(isHexColor("a1b2c3")).toBe(false);
        expect(isHexColor("#fff")).toBe(false);
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

describe("graph: Instagram que não vem no campo da Página", () => {
    afterEach(() => vi.unstubAllGlobals());
    const stub = (handler: (url: string) => unknown) =>
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            const json: any = handler(url);
            return { ok: !json?.error, status: 200, json: async () => json };
        }));

    it("usa connected_instagram_account", async () => {
        stub(() => ({ data: [{ id: "P1", name: "Salão", access_token: "PT", connected_instagram_account: { id: "I9", username: "salao" } }] }));
        const a = await discoverAccounts("UT");
        expect(a.map((x) => x.provider)).toEqual(["facebook", "instagram"]);
    });
    it("cai no /instagram_accounts da Página", async () => {
        stub((url) => (url.includes("/P1/instagram_accounts") ? { data: [{ id: "I7", username: "salao" }] } : { data: [{ id: "P1", name: "Salão", access_token: "PT" }] }));
        const a = await discoverAccounts("UT");
        expect(a.find((x) => x.provider === "instagram")?.externalId).toBe("I7");
    });
    it("lista as Páginas que ficaram sem Instagram", async () => {
        stub((url) => (url.includes("instagram_accounts") ? { data: [] } : { data: [{ id: "P1", name: "Salão", access_token: "PT" }] }));
        const a = await discoverAccounts("UT");
        expect(pagesWithoutInstagram(a)).toEqual(["Salão"]);
    });
});
