import { describe, it, expect, vi, beforeEach } from "vitest";

const { createMany, claim, accounts, closeSeries } = vi.hoisted(() => ({
    createMany: vi.fn(async (_args?: unknown) => ({ count: 0 })),
    claim: vi.fn(async (_args?: unknown) => ({ count: 1 })),
    accounts: vi.fn(async () => [{ id: "a1" }, { id: "a2" }]),
    closeSeries: vi.fn(async (_args?: unknown) => ({ count: 1 })),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        socialAccount: { findMany: accounts },
        postSeries: { updateMany: closeSeries },
        $transaction: async (fn: (tx: unknown) => unknown) => fn({ postSeries: { updateMany: claim }, scheduledPost: { createMany } }),
    },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { computeOccurrences, describeRule, generateForSeries, parseSeries, parseVariants } from "./series";

const iso = (ds: Date[]) => ds.map((d) => d.toISOString());
// Brasília (UTC-3, sem horário de verão): 10:00 = 13:00Z
const NOW = new Date("2026-10-14T12:00:00Z"); // quarta, 09:00 em Brasília

describe("computeOccurrences", () => {
    const rule = { weekdays: [2], time: "10:00", startDate: "2026-10-14", endDate: null };

    it("toda terça às 10h, no fuso de Brasília", () => {
        const r = computeOccurrences(rule, NOW, new Date("2026-11-11T00:00:00Z"));
        expect(iso(r)).toEqual(["2026-10-20T13:00:00.000Z", "2026-10-27T13:00:00.000Z", "2026-11-03T13:00:00.000Z", "2026-11-10T13:00:00.000Z"]);
    });
    it("respeita a data final (inclusive)", () => {
        const r = computeOccurrences({ ...rule, endDate: "2026-10-27" }, NOW, new Date("2026-12-31T00:00:00Z"));
        expect(iso(r)).toEqual(["2026-10-20T13:00:00.000Z", "2026-10-27T13:00:00.000Z"]);
    });
    it("`after` é exclusivo e `until` é inclusivo", () => {
        const r = computeOccurrences(rule, new Date("2026-10-20T13:00:00Z"), new Date("2026-10-27T13:00:00Z"));
        expect(iso(r)).toEqual(["2026-10-27T13:00:00.000Z"]);
    });
    it("não gera antes da data de início", () => {
        const r = computeOccurrences({ ...rule, startDate: "2026-11-01" }, NOW, new Date("2026-11-12T00:00:00Z"));
        expect(iso(r)[0]).toBe("2026-11-03T13:00:00.000Z");
    });
    it("vários dias na semana saem em ordem", () => {
        const r = computeOccurrences({ ...rule, weekdays: [4, 2] }, NOW, new Date("2026-10-23T00:00:00Z"));
        expect(iso(r)).toEqual(["2026-10-15T13:00:00.000Z", "2026-10-20T13:00:00.000Z", "2026-10-22T13:00:00.000Z"]);
    });
});

describe("describeRule", () => {
    it("monta o texto", () => {
        expect(describeRule({ weekdays: [2], time: "10:00" })).toBe("toda terça às 10:00");
        expect(describeRule({ weekdays: [2, 4, 6], time: "09:30" })).toBe("toda terça, quinta e sábado às 09:30");
    });
});

describe("parseSeries", () => {
    const base = {
        name: "Dica da terça", accountIds: ["a1"], type: "FEED", weekdays: [2], time: "10:00", startDate: "2026-10-14", maxCount: 8,
        variants: [{ caption: "oi", mediaIds: ["m1"] }],
    };
    const run = (extra: object = {}, prov: ("instagram" | "facebook")[] = ["instagram"]) => parseSeries({ ...base, ...extra }, prov, "2026-10-14");

    it("aceita série válida", () => {
        expect(run()).toHaveProperty("value");
        expect(run({ maxCount: null, endDate: "2026-12-30" })).toHaveProperty("value");
    });
    it("exige fim: data final ou número de postagens", () => {
        expect(run({ maxCount: null, endDate: null })).toHaveProperty("error");
    });
    it("rejeita entradas inválidas", () => {
        expect(run({ name: " " })).toHaveProperty("error");
        expect(run({ accountIds: [] })).toHaveProperty("error");
        expect(run({ accountIds: ["1", "2", "3", "4", "5", "6"] })).toHaveProperty("error");
        expect(run({ type: "REEL" })).toHaveProperty("error");
        expect(run({ weekdays: [] })).toHaveProperty("error");
        expect(run({ weekdays: [7] })).toHaveProperty("error");
        expect(run({ time: "25:00" })).toHaveProperty("error");
        expect(run({ startDate: "2026-10-13" })).toHaveProperty("error");
        expect(run({ startDate: "14/10/2026" })).toHaveProperty("error");
        expect(run({ endDate: "2026-10-01", maxCount: null })).toHaveProperty("error");
        expect(run({ endDate: "2028-01-01", maxCount: null })).toHaveProperty("error");
        expect(run({ maxCount: 0 })).toHaveProperty("error");
        expect(run({ maxCount: 201 })).toHaveProperty("error");
        expect(run({ variants: [] })).toHaveProperty("error");
    });
    it("remove dias e contas repetidos", () => {
        const r = run({ weekdays: [4, 2, 2], accountIds: ["a1", "a1"] });
        expect("value" in r && [r.value.weekdays, r.value.accountIds]).toEqual([[2, 4], ["a1"]]);
    });
});

describe("parseVariants", () => {
    it("Story: exatamente 1 imagem e sem legenda", () => {
        expect(parseVariants([{ caption: "x", mediaIds: ["a", "b"] }], "STORY", ["instagram"])).toHaveProperty("error");
        const r = parseVariants([{ caption: "x", mediaIds: ["a"] }], "STORY", ["instagram"]);
        expect("value" in r && r.value[0].caption).toBe("");
    });
    it("limites de legenda e de variações", () => {
        expect(parseVariants([{ caption: "x".repeat(2201), mediaIds: ["a"] }], "FEED", ["instagram"])).toHaveProperty("error");
        expect(parseVariants(Array.from({ length: 13 }, () => ({ caption: "", mediaIds: ["a"] })), "FEED", ["instagram"])).toHaveProperty("error");
    });
});

describe("generateForSeries", () => {
    beforeEach(() => vi.clearAllMocks());
    const series = (extra: object = {}) => ({
        id: "s1", userId: "u1", accountIds: ["a1", "a2"], type: "FEED", weekdays: [2, 4], time: "10:00", startDate: "2026-10-14", endDate: null,
        maxCount: 3, variants: [{ caption: "A", mediaIds: ["m1"] }, { caption: "B", mediaIds: ["m2"] }], status: "ACTIVE",
        generatedCount: 0, generatedThrough: NOW, ...extra,
    });

    it("cria uma postagem por conta × data, alterna as variações e encerra ao bater a contagem", async () => {
        const n = await generateForSeries(series(), NOW);
        expect(n).toBe(6);
        const rows = (createMany.mock.calls[0] as unknown as [{ data: any[] }])[0].data;
        expect(rows.map((r) => [r.seriesIndex, r.caption, r.accountId])).toEqual([
            [0, "A", "a1"], [0, "A", "a2"], [1, "B", "a1"], [1, "B", "a2"], [2, "A", "a1"], [2, "A", "a2"],
        ]);
        expect(rows.every((r) => r.groupId === "s1" && r.seriesId === "s1" && r.status === "PENDING")).toBe(true);
        expect(claim).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ generatedCount: 3, status: "ENDED" }) }));
    });

    it("sem fim por contagem: avança o horizonte e continua ativa", async () => {
        await generateForSeries(series({ maxCount: null, endDate: "2027-12-31" }), NOW);
        const call = claim.mock.calls[0] as unknown as [{ data: { status: string; generatedThrough: Date } }];
        expect(call[0].data.status).toBe("ACTIVE");
        expect(call[0].data.generatedThrough.toISOString()).toBe(new Date(NOW.getTime() + 56 * 86_400_000).toISOString());
    });

    it("continua de onde parou (não recria o que já foi gerado nem o que foi pulado)", async () => {
        await generateForSeries(series({ maxCount: null, endDate: "2027-12-31", generatedCount: 4, generatedThrough: new Date("2026-11-30T00:00:00Z") }), NOW);
        const rows = (createMany.mock.calls[0] as unknown as [{ data: any[] }])[0].data;
        expect(rows.every((r) => r.publishAt > new Date("2026-11-30T00:00:00Z"))).toBe(true);
        expect(rows[0].seriesIndex).toBe(4);
    });

    it("pausada ou encerrada não gera", async () => {
        expect(await generateForSeries(series({ status: "PAUSED" }), NOW)).toBe(0);
        expect(createMany).not.toHaveBeenCalled();
    });

    it("sem nenhuma conta viva, encerra a série", async () => {
        accounts.mockResolvedValueOnce([]);
        expect(await generateForSeries(series(), NOW)).toBe(0);
        expect(closeSeries).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "ENDED" } }));
        expect(createMany).not.toHaveBeenCalled();
    });

    it("se outra rodada gerou no meio (claim falha), não duplica", async () => {
        claim.mockResolvedValueOnce({ count: 0 });
        expect(await generateForSeries(series(), NOW)).toBe(0);
        expect(createMany).not.toHaveBeenCalled();
    });
});
