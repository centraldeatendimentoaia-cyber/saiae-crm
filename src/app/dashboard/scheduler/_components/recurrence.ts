export interface RecurrenceSetters {
    setRecurring: (v: string) => void;
    setType: (v: string) => void;
    setMins: (v: number) => void;
    setHrs: (v: number) => void;
    setDays: (v: number[]) => void;
    setCron: (v: string) => void;
}

export const parseRecurrence = (ruleStr: string | undefined, cronExpr: string | undefined, s: RecurrenceSetters) => {
    if (!cronExpr) {
        s.setRecurring("once");
        return;
    }
    s.setRecurring("recurring");
    s.setCron(cronExpr);
    if (ruleStr) {
        try {
            const rule = JSON.parse(ruleStr);
            s.setType(rule.type || "cron");
            if (rule.type === "minutes") s.setMins(rule.value);
            if (rule.type === "hours") s.setHrs(rule.value);
            if (rule.type === "days") s.setDays(rule.value);
        } catch {
            s.setType("cron");
        }
    } else {
        s.setType("cron");
    }
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
