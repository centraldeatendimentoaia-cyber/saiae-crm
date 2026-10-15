import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { buildCronData, parseRecurrence, DEFAULT_RECURRENCE } from "./recurrence";
import { computeSendAt, cronDataFor, formFromMessage, jidWithSuffix, EMPTY_SCHEDULE_FORM } from "./schedule-form";
import type { ScheduledMessage } from "./message-list";

const TZ = "America/Sao_Paulo";

describe("computeSendAt", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-10T15:00:00Z")); // 12:00 em Sao Paulo
    });
    afterEach(() => vi.useRealTimers());

    it("envio unico exige data e devolve o que foi digitado", () => {
        expect(computeSendAt({ ...DEFAULT_RECURRENCE }, TZ)).toEqual({ error: "Informe a data e hora de envio" });
        expect(computeSendAt({ ...DEFAULT_RECURRENCE, sendAt: "2026-03-11T09:30" }, TZ)).toEqual({ value: "2026-03-11T09:30" });
    });

    it("recorrente por minutos ou horas comeca agora, no fuso do sistema", () => {
        const v = { ...DEFAULT_RECURRENCE, isRecurring: "recurring", recurrenceType: "minutes" };
        expect(computeSendAt(v, TZ)).toEqual({ value: "2026-03-10T12:00:00" });
    });

    it("recorrente por dias exige o horario e usa o dia de hoje", () => {
        const v = { ...DEFAULT_RECURRENCE, isRecurring: "recurring", recurrenceType: "days" };
        expect(computeSendAt(v, TZ)).toEqual({ error: "Informe o horário do dia" });
        const r = computeSendAt({ ...v, sendTime: "14:30" }, TZ);
        expect("value" in r && r.value.endsWith("T14:30:00")).toBe(true);
    });
});

describe("buildCronData / cronDataFor", () => {
    it("envio unico nao tem cron", () => {
        expect(cronDataFor(DEFAULT_RECURRENCE, "2026-03-10T12:00:00")).toEqual({ cronExpression: null, recurrenceRule: null });
    });

    it("gera o cron de cada tipo de repeticao", () => {
        expect(buildCronData("recurring", "minutes", 15, 1, [], "", "")).toEqual({ cronExpression: "*/15 * * * *", recurrenceRule: '{"type":"minutes","value":15}' });
        expect(buildCronData("recurring", "hours", 5, 2, [], "", "")).toEqual({ cronExpression: "0 */2 * * *", recurrenceRule: '{"type":"hours","value":2}' });
        expect(buildCronData("recurring", "cron", 5, 1, [], "0 12 * * *", "").cronExpression).toBe("0 12 * * *");
        const dias = buildCronData("recurring", "days", 5, 1, [1, 3], "", "2026-03-10T14:30:00");
        expect(dias.cronExpression).toBe("30 14 * * 1,3");
        expect(buildCronData("recurring", "days", 5, 1, [], "", "2026-03-10T14:30:00").cronExpression).toBe("30 14 * * *");
    });
});

describe("parseRecurrence", () => {
    it("sem cron e envio unico", () => {
        expect(parseRecurrence(undefined, undefined)).toEqual({ isRecurring: "once" });
    });

    it("le tipo e valor da regra guardada", () => {
        expect(parseRecurrence('{"type":"minutes","value":15}', "*/15 * * * *")).toEqual({ isRecurring: "recurring", customCron: "*/15 * * * *", recurrenceType: "minutes", recurringMinutes: 15, customCron: "*/15 * * * *" });
        expect(parseRecurrence('{"type":"days","value":[1,3]}', "30 14 * * 1,3").recurringDays).toEqual([1, 3]);
    });

    it("regra ausente ou quebrada cai para cron personalizado", () => {
        expect(parseRecurrence(undefined, "0 12 * * *").recurrenceType).toBe("cron");
        expect(parseRecurrence("{quebrado", "0 12 * * *").recurrenceType).toBe("cron");
    });
});

describe("jidWithSuffix / formFromMessage", () => {
    it("completa o JID conforme o tipo e respeita um JID ja completo", () => {
        expect(jidWithSuffix("5511999999999", "personal")).toBe("5511999999999@s.whatsapp.net");
        expect(jidWithSuffix("123", "group")).toBe("123@g.us");
        expect(jidWithSuffix("123", "newsletter")).toBe("123@newsletter");
        expect(jidWithSuffix("123@g.us", "personal")).toBe("123@g.us");
    });

    it("preenche o formulario de edicao a partir do agendamento", () => {
        const msg: ScheduledMessage = {
            id: "1", jid: "120363@g.us", content: "Oi", sendAt: "2026-03-10T15:30:00Z", status: "PENDING",
            cronExpression: "*/15 * * * *", recurrenceRule: '{"type":"minutes","value":15}',
        };
        const f = formFromMessage(msg, TZ);
        expect(f).toMatchObject({ ...EMPTY_SCHEDULE_FORM, jidType: "group", jid: "120363", content: "Oi", sendAt: "2026-03-10T12:30", sendTime: "12:30", isRecurring: "recurring", recurrenceType: "minutes", recurringMinutes: 15, customCron: "*/15 * * * *" });
    });
});
