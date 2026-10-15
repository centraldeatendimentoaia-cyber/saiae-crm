import moment from "moment-timezone";
import { buildCronData, DEFAULT_RECURRENCE, parseRecurrence, type RecurrenceValues } from "./recurrence";
import type { ScheduledMessage } from "./message-list";

/** Tudo que o formulário de agendar/editar guarda. */
export interface ScheduleFormValues extends RecurrenceValues {
    jidType: string; // "personal" | "group" | "newsletter"
    jid: string;
    content: string;
    mediaUrl: string;
    mediaType: string;
}

export const EMPTY_SCHEDULE_FORM: ScheduleFormValues = {
    ...DEFAULT_RECURRENCE,
    jidType: "personal",
    jid: "",
    content: "",
    mediaUrl: "",
    mediaType: "image",
};

/**
 * Data/hora do primeiro envio. Recorrente por dias: hoje no horário escolhido; demais recorrências: agora;
 * envio único: o que o usuário digitou. Devolve a mensagem de erro quando falta o dado.
 */
export function computeSendAt(v: RecurrenceValues, timezone: string): { error: string } | { value: string } {
    if (v.isRecurring === "recurring") {
        if (v.recurrenceType === "days") {
            if (!v.sendTime) return { error: "Informe o horário do dia" };
            // Construct a valid local date-time string
            return { value: `${moment().format("YYYY-MM-DD")}T${v.sendTime}:00` };
        }
        // For minutes, hours, cron: start from now
        return { value: moment().tz(timezone).format("YYYY-MM-DDTHH:mm:ss") };
    }
    if (!v.sendAt) return { error: "Informe a data e hora de envio" };
    return { value: v.sendAt };
}

/** Campos cronExpression/recurrenceRule da requisição para o formulário e o primeiro envio. */
export const cronDataFor = (v: RecurrenceValues, finalSendAt: string) =>
    buildCronData(v.isRecurring, v.recurrenceType, v.recurringMinutes, v.recurringHours, v.recurringDays, v.customCron, finalSendAt);

/** JID completo a partir do que foi digitado e do tipo (padrão @s.whatsapp.net). */
export function jidWithSuffix(jid: string, jidType: string): string {
    if (jid.includes("@")) return jid;
    if (jidType === "group") return jid + "@g.us";
    if (jidType === "newsletter") return jid + "@newsletter";
    return jid + "@s.whatsapp.net";
}

/** Preenche o formulário de edição com um agendamento existente. */
export function formFromMessage(msg: ScheduledMessage, timezone: string): ScheduleFormValues {
    const isGroup = msg.jid.includes("@g.us");
    const isNewsletter = msg.jid.includes("@newsletter");
    return {
        ...EMPTY_SCHEDULE_FORM,
        jidType: isGroup ? "group" : isNewsletter ? "newsletter" : "personal",
        jid: msg.jid.split("@")[0],
        content: msg.content || "",
        mediaUrl: msg.mediaUrl || "",
        mediaType: msg.mediaType || "image",
        sendAt: moment.tz(msg.sendAt, timezone).format("YYYY-MM-DDTHH:mm"),
        sendTime: moment.tz(msg.sendAt, timezone).format("HH:mm"),
        ...parseRecurrence(msg.recurrenceRule, msg.cronExpression),
    };
}
