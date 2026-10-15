const UNIDADES: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 3600],
    ["month", 30 * 24 * 3600],
    ["day", 24 * 3600],
    ["hour", 3600],
    ["minute", 60],
];

const formatador = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

/** "há 5 minutos", "ontem", "agora" etc. Entrada inválida devolve "". */
export function tempoRelativo(data: Date | string | number, agora: number = Date.now()): string {
    const alvo = new Date(data).getTime();
    if (Number.isNaN(alvo)) return "";
    const segundos = Math.round((alvo - agora) / 1000);
    if (Math.abs(segundos) < 45) return "agora";
    for (const [unidade, base] of UNIDADES) {
        if (Math.abs(segundos) >= base) return formatador.format(Math.round(segundos / base), unidade);
    }
    return formatador.format(Math.round(segundos / 60), "minute");
}
