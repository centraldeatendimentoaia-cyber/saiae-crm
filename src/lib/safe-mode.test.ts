import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { prisma } = vi.hoisted(() => ({ prisma: { session: { findUnique: vi.fn() } } }));
vi.mock("@/lib/prisma", () => ({ prisma }));

import { inSendWindow, nextOpening, getSafeMode, safeGate, humanDelayMs, batchPauseMs, type SafeMode } from "./safe-mode";

const safe: SafeMode = { delayMinSec: 10, delayMaxSec: 40, batchSize: 25, batchPauseMin: 3, startHour: 9, endHour: 19 };

// Brasília é UTC-3 o ano todo (sem horário de verão desde 2019).
const brt = (iso: string) => new Date(`${iso}-03:00`);

beforeEach(() => prisma.session.findUnique.mockReset());
afterEach(() => vi.useRealTimers());

describe("inSendWindow", () => {
    it("dentro do horário em dia útil", () => {
        expect(inSendWindow(safe, brt("2026-10-07T10:00:00"))).toBe(true); // quarta
    });
    it("fora do horário", () => {
        expect(inSendWindow(safe, brt("2026-10-07T08:59:00"))).toBe(false);
        expect(inSendWindow(safe, brt("2026-10-07T19:00:00"))).toBe(false);
    });
    it("sábado vale, domingo não", () => {
        expect(inSendWindow(safe, brt("2026-10-10T10:00:00"))).toBe(true);
        expect(inSendWindow(safe, brt("2026-10-11T10:00:00"))).toBe(false);
    });
});

describe("nextOpening / safeGate", () => {
    it("depois das 19h de sábado, volta na segunda às 9h", () => {
        const next = nextOpening(safe, brt("2026-10-10T19:30:00"));
        expect(next.toISOString()).toBe(brt("2026-10-12T09:00:00").toISOString());
    });
    it("safeGate libera dentro da janela e informa a retomada fora dela", () => {
        vi.useFakeTimers();
        vi.setSystemTime(brt("2026-10-07T10:00:00"));
        expect(safeGate(safe)).toEqual({ ok: true });
        vi.setSystemTime(brt("2026-10-07T20:00:00"));
        const g = safeGate(safe);
        expect(g.ok).toBe(false);
        if (!g.ok) expect(g.resumeAt.toISOString()).toBe(brt("2026-10-08T09:00:00").toISOString());
    });
});

describe("getSafeMode", () => {
    it("sessão inexistente: null", async () => {
        prisma.session.findUnique.mockResolvedValue(null);
        expect(await getSafeMode("x")).toBeNull();
    });
    it("anti-spam desligado: null (sem restrições)", async () => {
        prisma.session.findUnique.mockResolvedValue({ botConfig: { antiSpamEnabled: false } });
        expect(await getSafeMode("x")).toBeNull();
    });
    it("sem configuração salva: ligado com os padrões", async () => {
        prisma.session.findUnique.mockResolvedValue({ botConfig: null });
        expect(await getSafeMode("x")).toEqual(safe);
    });
    it("limita valores absurdos e corrige janela invertida", async () => {
        prisma.session.findUnique.mockResolvedValue({
            botConfig: { antiSpamEnabled: true, safeDelayMin: 0, safeDelayMax: 5, safeBatchSize: 99999, safeBatchPause: 0, safeStartHour: 20, safeEndHour: 8 },
        });
        const s = await getSafeMode("x");
        expect(s).toMatchObject({ delayMinSec: 1, delayMaxSec: 5, batchSize: 1000, batchPauseMin: 1, startHour: 20 });
        expect(s!.endHour).toBeGreaterThan(s!.startHour);
    });
    it("o máximo nunca fica abaixo do mínimo", async () => {
        prisma.session.findUnique.mockResolvedValue({ botConfig: { antiSpamEnabled: true, safeDelayMin: 50, safeDelayMax: 10 } });
        const s = await getSafeMode("x");
        expect(s!.delayMaxSec).toBeGreaterThanOrEqual(s!.delayMinSec);
    });
});

describe("intervalos", () => {
    it("humanDelayMs fica entre o mínimo e o máximo", () => {
        for (let i = 0; i < 200; i++) {
            const d = humanDelayMs(safe);
            expect(d).toBeGreaterThanOrEqual(10_000);
            expect(d).toBeLessThanOrEqual(40_000);
        }
    });
    it("respeita um atraso maior pedido pelo formulário", () => {
        expect(humanDelayMs(safe, 60_000)).toBeGreaterThanOrEqual(60_000);
    });
    it("batchPauseMs fica entre 1x e 1,6x o configurado", () => {
        for (let i = 0; i < 200; i++) {
            const p = batchPauseMs(safe);
            expect(p).toBeGreaterThanOrEqual(180_000);
            expect(p).toBeLessThanOrEqual(288_000);
        }
    });
});
