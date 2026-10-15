/** Datas no fuso de São Paulo. Sem dependências: pode ser importado por qualquer módulo (inclusive o avaliador) sem subir banco nem agendador. */

export const TZ_SAO_PAULO = "America/Sao_Paulo";

/** "AAAA-MM-DD" no fuso de São Paulo. */
export function diaSaoPaulo(d: Date): string {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ_SAO_PAULO, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const v = (t: string) => p.find((x) => x.type === t)?.value;
    return `${v("year")}-${v("month")}-${v("day")}`;
}

/** Dia da semana (0 = domingo) e hora (0-23) em Brasília. */
export function diaEHora(d: Date): { dia: number; hora: number } {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ_SAO_PAULO, weekday: "short", hour: "numeric", hourCycle: "h23" });
    const o: Record<string, string> = {};
    for (const p of f.formatToParts(d)) o[p.type] = p.value;
    const dias = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return { dia: dias.indexOf(o.weekday), hora: Number(o.hour) };
}
