/** Datas no fuso de São Paulo. Módulo sem dependências: pode ser importado pelo avaliador sem subir banco nem agendador. */

/** "AAAA-MM-DD" no fuso de São Paulo. */
export function diaSaoPaulo(d: Date): string {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const v = (t: string) => p.find((x) => x.type === t)?.value;
    return `${v("year")}-${v("month")}-${v("day")}`;
}
