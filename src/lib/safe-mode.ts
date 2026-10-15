import { TZ_SAO_PAULO } from "@/modules/atendimento-comum/tempo";
import { prisma } from "@/lib/prisma";

/**
 * Modo Seguro dos disparos: reduz o risco de bloqueio do número.
 * Vale só para números com o Anti-Spam ligado (Configurações do bot). Com o Anti-Spam
 * desligado, nada aqui se aplica e os envios seguem sem restrição.
 *
 * Tudo é configurável por número (Configurações do bot):
 * - Janela de horário (padrão seg a sáb, 9h às 19h, Brasília). Fora dela, o envio espera.
 * - Intervalo entre mensagens (padrão 10 a 40 s) e pausa a cada lote (padrão 3 min a cada 25).
 * - Freio automático: lista com muitos números sem WhatsApp ou erros seguidos param o disparo.
 * Não há limite diário: quem quer enviar mais assume o risco (a tela avisa).
 */

const TZ = TZ_SAO_PAULO;

/** Taxa máxima de números sem WhatsApp antes de a campanha parar sozinha (a partir de MIN_CHECKED). */
export const MAX_INVALID_RATE = 0.15;
export const MIN_CHECKED = 30;
export const MAX_CONSECUTIVE_ERRORS = 5;

export interface SafeMode {
    delayMinSec: number;
    delayMaxSec: number;
    batchSize: number; // 0 = sem pausa entre lotes
    batchPauseMin: number;
    startHour: number;
    endHour: number;
}

export type Gate = { ok: true } | { ok: false; resumeAt: Date };

export const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function localParts(d: Date) {
    const f = new Intl.DateTimeFormat("en-US", {
        timeZone: TZ, weekday: "short", hour: "numeric", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    });
    const o: Record<string, string> = {};
    for (const p of f.formatToParts(d)) o[p.type] = p.value;
    return { weekday: o.weekday, hour: Number(o.hour), day: `${o.year}-${o.month}-${o.day}` };
}

export function inSendWindow(safe: SafeMode, d: Date = new Date()): boolean {
    const p = localParts(d);
    return p.weekday !== "Sun" && p.hour >= safe.startHour && p.hour < safe.endHour;
}

/** Próximo instante (em passos de 10 min) dentro da janela. */
export function nextOpening(safe: SafeMode, from: Date = new Date()): Date {
    let t = from.getTime();
    for (let i = 0; i < 8 * 144; i++) {
        t += 10 * 60 * 1000;
        if (inSendWindow(safe, new Date(t))) return new Date(t);
    }
    return new Date(t);
}

const clamp = (v: unknown, min: number, max: number, def: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/** Retorna o Modo Seguro da sessão, ou null quando o Anti-Spam está desligado. */
export async function getSafeMode(sessionId: string): Promise<SafeMode | null> {
    const s = await prisma.session.findUnique({
        where: { sessionId },
        select: { botConfig: { select: { antiSpamEnabled: true, safeDelayMin: true, safeDelayMax: true, safeBatchSize: true, safeBatchPause: true, safeStartHour: true, safeEndHour: true } } },
    });
    if (!s) return null;
    const c = s.botConfig;
    if (c && !c.antiSpamEnabled) return null; // sem configuração salva = ligado, com os padrões

    const delayMinSec = clamp(c?.safeDelayMin, 1, 600, 10);
    const startHour = clamp(c?.safeStartHour, 0, 23, 9);
    let endHour = clamp(c?.safeEndHour, 1, 24, 19);
    if (endHour <= startHour) endHour = Math.min(24, startHour + 1);
    return {
        delayMinSec,
        delayMaxSec: Math.max(delayMinSec, clamp(c?.safeDelayMax, 1, 1800, 40)),
        batchSize: clamp(c?.safeBatchSize, 0, 1000, 25),
        batchPauseMin: clamp(c?.safeBatchPause, 1, 120, 3),
        startHour,
        endHour,
    };
}

/** Pode enviar agora? Se não, diz quando a janela volta. */
export function safeGate(safe: SafeMode): Gate {
    return inSendWindow(safe) ? { ok: true } : { ok: false, resumeAt: nextOpening(safe) };
}

/** Intervalo sorteado entre mensagens (respeita o atraso do formulário, se maior). */
export function humanDelayMs(safe: SafeMode, minMs = 0): number {
    const lo = Math.max(safe.delayMinSec * 1000, minMs);
    const hi = Math.max(lo, safe.delayMaxSec * 1000);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/** Pausa entre lotes (de 1x a 1,6x o tempo configurado). */
export function batchPauseMs(safe: SafeMode): number {
    const base = safe.batchPauseMin * 60_000;
    return base + Math.floor(Math.random() * base * 0.6);
}

export function gateMessage(safe: SafeMode, g: Extract<Gate, { ok: false }>): string {
    const when = g.resumeAt.toLocaleString("pt-BR", { timeZone: TZ, weekday: "long", hour: "2-digit", minute: "2-digit" });
    return `Fora do horário configurado (seg a sáb, ${safe.startHour}h às ${safe.endHour}h). O restante continua automaticamente (${when}).`;
}
