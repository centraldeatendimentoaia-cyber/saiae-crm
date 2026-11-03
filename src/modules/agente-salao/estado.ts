/**
 * Regras puras do agente do salão (sem banco nem WhatsApp): quando a IA está calada, quando o salão está aberto,
 * quando vale um follow-up e como reconhecer que uma pessoa assumiu a conversa. Tudo testável com relógio injetado.
 */

import { iaPausada } from "@/modules/atendimento-comum/pausa";
import { diaEHora } from "@/modules/atendimento-comum/tempo";

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

// Pausa (iaPausada) e fuso de São Paulo (diaEHora) são comuns ao módulo ia-atendimento.
export { iaPausada, diaEHora };

export function salaoAberto(cfg: ConfigHorario, agora: Date): boolean {
    const abertos = cfg.diasAbertos.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
    const { dia, hora } = diaEHora(agora);
    return abertos.includes(dia) && hora >= cfg.horaAbre && hora < cfg.horaFecha;
}

/** "#lavinia" digitado pela recepção na conversa devolve a IA na hora. */
export function ehComandoDevolver(texto: string): boolean {
    return /^\s*#\s*lav[ií]nia\s*$/i.test(texto);
}

/**
 * Mensagem "de dentro do número" (fromMe) que NÃO saiu do CRM/da IA: uma pessoa escreveu pelo celular ou pelo WhatsApp Web.
 * `enviadaPeloCrm` vem do registro de IDs enviados; mensagens antigas (histórico que chega ao reconectar) não contam.
 */
export const JANELA_AUTOMATICA_MS = 10_000;

export function pessoaAssumiu(args: { fromMe: boolean; enviadaPeloCrm: boolean; criadaEm: Date; agora: Date; tipoEvento: string; ultimaInboundAt?: Date | null }): boolean {
    if (!args.fromMe || args.enviadaPeloCrm) return false;
    if (args.tipoEvento !== "notify" && args.tipoEvento !== "append") return false;
    // shortcut: resposta "fromMe" até 10 s depois da cliente escrever é saudação/ausência automática do WhatsApp Business, não uma pessoa; sem como distinguir de uma pessoa muito rápida
    if (args.ultimaInboundAt) {
        const depois = args.criadaEm.getTime() - args.ultimaInboundAt.getTime();
        if (depois >= 0 && depois <= JANELA_AUTOMATICA_MS) return false;
    }
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

/** Lembrete: o texto do dono (com {nome}) ou, se não houver, o padrão do salão. */
export const textoFollowUp = (nome: string | null, servico: string | null, modelo?: string | null): string => {
    if (modelo?.trim()) {
        return modelo
            .replace(/\{nome\}/gi, nome ?? "")
            .replace(/,\s*([!.?])/g, "$1")
            .replace(/\s{2,}/g, " ")
            .replace(/\s+([!.?,])/g, "$1")
            .trim();
    }
    const quem = nome ? `Oi, ${nome}!` : "Oi!";
    const sobre = servico ? ` sobre ${servico}` : "";
    return `${quem} Passando pra ver se você conseguiu decidir${sobre}. Se quiser, eu passo pra recepção ver um horário pra você 💛`;
};
