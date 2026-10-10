/**
 * Regras puras do agente do salão (sem banco nem WhatsApp): quando a IA está calada, quando o salão está aberto,
 * quando vale um follow-up e como reconhecer que uma pessoa assumiu a conversa. Tudo testável com relógio injetado.
 */

export interface ConfigHorario {
    diasAbertos: string; // "2,3,4,5,6" (0 = domingo)
    horaAbre: number;
    horaFecha: number;
}

export interface ConversaEstado {
    estado: string; // ia | humano
    pausadaAte: Date | null;
    ultimaInboundAt: Date | null;
    ultimaIaAt: Date | null;
    ultimaIaPerguntou: boolean;
    ultimaHumanoAt: Date | null;
    followUpEm: Date | null;
}

const TZ = "America/Sao_Paulo";

/** Dia da semana (0 = domingo) e hora (0-23) em Brasília. */
export function diaEHora(d: Date): { dia: number; hora: number } {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", hourCycle: "h23" });
    const o: Record<string, string> = {};
    for (const p of f.formatToParts(d)) o[p.type] = p.value;
    const dias = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return { dia: dias.indexOf(o.weekday), hora: Number(o.hour) };
}

export function salaoAberto(cfg: ConfigHorario, agora: Date): boolean {
    const abertos = cfg.diasAbertos.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
    const { dia, hora } = diaEHora(agora);
    return abertos.includes(dia) && hora >= cfg.horaAbre && hora < cfg.horaFecha;
}

/** A IA está calada nesta conversa? (uma pessoa assumiu ou a recepção foi chamada, e a pausa ainda não venceu) */
export function iaPausada(c: Pick<ConversaEstado, "estado" | "pausadaAte">, agora: Date): boolean {
    return c.estado === "humano" && c.pausadaAte !== null && c.pausadaAte > agora;
}

/** "#lavinia" digitado pela recepção na conversa devolve a IA na hora. */
export function ehComandoDevolver(texto: string): boolean {
    return /^\s*#\s*lav[ií]nia\s*$/i.test(texto);
}

/**
 * Mensagem "de dentro do número" (fromMe) que NÃO saiu do CRM/da IA: uma pessoa escreveu pelo celular ou pelo WhatsApp Web.
 * `enviadaPeloCrm` vem do registro de IDs enviados; mensagens antigas (histórico que chega ao reconectar) não contam.
 */
export function pessoaAssumiu(args: { fromMe: boolean; enviadaPeloCrm: boolean; criadaEm: Date; agora: Date; tipoEvento: string }): boolean {
    if (!args.fromMe || args.enviadaPeloCrm) return false;
    if (args.tipoEvento !== "notify" && args.tipoEvento !== "append") return false;
    return args.agora.getTime() - args.criadaEm.getTime() <= 120_000;
}

export const FOLLOWUP_MAX_HORAS = 36;

/**
 * Follow-up só quando: a cliente escreveu, a IA foi a última a falar (e perguntou algo), ninguém respondeu há `horas`,
 * nenhuma pessoa interveio depois, a IA não está calada, ainda não houve follow-up, não passou tempo demais e o
 * salão está aberto (para não mandar mensagem de madrugada).
 */
export function devidoFollowUp(c: ConversaEstado, cfg: ConfigHorario & { followUpHoras: number }, agora: Date): boolean {
    if (c.followUpEm || !c.ultimaInboundAt || !c.ultimaIaAt) return false;
    if (iaPausada(c, agora)) return false;
    if (!c.ultimaIaPerguntou) return false;
    if (c.ultimaIaAt <= c.ultimaInboundAt) return false; // a cliente falou por último
    if (c.ultimaHumanoAt && c.ultimaHumanoAt >= c.ultimaIaAt) return false; // uma pessoa falou depois da IA
    const horas = (agora.getTime() - c.ultimaIaAt.getTime()) / 3_600_000;
    if (horas < cfg.followUpHoras || horas > FOLLOWUP_MAX_HORAS) return false;
    return salaoAberto(cfg, agora);
}

/** Primeiro nome a partir do nome do perfil do WhatsApp (só letras; descarta apelidos estranhos). */
export function primeiroNome(perfil: string | null | undefined): string | null {
    if (!perfil) return null;
    const p = perfil.trim().split(/\s+/)[0] ?? "";
    if (!/^[\p{L}][\p{L}'-]{1,19}$/u.test(p)) return null;
    return p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1).toLocaleLowerCase("pt-BR");
}

export const textoFollowUp = (nome: string | null, servico: string | null): string => {
    const quem = nome ? `Oi, ${nome}!` : "Oi!";
    const sobre = servico ? ` sobre ${servico}` : "";
    return `${quem} Passando pra ver se você conseguiu decidir${sobre}. Se quiser, eu passo pra recepção ver um horário pra você 💛`;
};
