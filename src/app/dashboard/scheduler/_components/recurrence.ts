/** Campos do formulário que descrevem quando e com que repetição a mensagem sai. */
export interface RecurrenceValues {
    isRecurring: string; // "once" | "recurring"
    recurrenceType: string; // "minutes" | "hours" | "days" | "cron"
    recurringMinutes: number;
    recurringHours: number;
    recurringDays: number[];
    customCron: string;
    sendAt: string; // datetime-local, para envio único
    sendTime: string; // HH:mm, para "dias da semana"
}

export const DEFAULT_RECURRENCE: RecurrenceValues = {
    isRecurring: "once",
    recurrenceType: "minutes",
    recurringMinutes: 5,
    recurringHours: 1,
    recurringDays: [],
    customCron: "",
    sendAt: "",
    sendTime: "",
};

/** Lê a regra guardada no agendamento (cron + JSON da regra) e devolve os campos do formulário que ela define. */
export const parseRecurrence = (ruleStr: string | undefined, cronExpr: string | undefined): Partial<RecurrenceValues> => {
    if (!cronExpr) return { isRecurring: "once" };
    const out: Partial<RecurrenceValues> = { isRecurring: "recurring", customCron: cronExpr };
    if (!ruleStr) return { ...out, recurrenceType: "cron" };
    try {
        const rule = JSON.parse(ruleStr);
        out.recurrenceType = rule.type || "cron";
        if (rule.type === "minutes") out.recurringMinutes = rule.value;
        if (rule.type === "hours") out.recurringHours = rule.value;
        if (rule.type === "days") out.recurringDays = rule.value;
    } catch {
        out.recurrenceType = "cron";
    }
    return out;
};

export const buildCronData = (isRec: string, type: string, mins: number, hrs: number, days: number[], custom: string, finalSendAt: string) => {
    if (isRec === "once") return { cronExpression: null, recurrenceRule: null };

    let cron = "";
    const rule: { type: string; value?: number | number[] | string } = { type };

    if (type === "minutes") {
        cron = `*/${mins} * * * *`;
        rule.value = mins;
    } else if (type === "hours") {
        cron = `0 */${hrs} * * *`;
        rule.value = hrs;
    } else if (type === "days") {
        // Because finalSendAt for days is constructed as YYYY-MM-DDT14:30:00,
        // parsing it via Date locally gives correct local hours and minutes.
        const date = new Date(finalSendAt);
        const m = date.getMinutes();
        const h = date.getHours();
        const dStr = days.length > 0 ? days.join(",") : "*";
        cron = `${m} ${h} * * ${dStr}`;
        rule.value = days;
    } else {
        cron = custom;
        rule.value = custom;
    }

    return { cronExpression: cron, recurrenceRule: JSON.stringify(rule) };
};
