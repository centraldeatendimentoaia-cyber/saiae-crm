import { prisma } from "@/lib/prisma";

/**
 * Modo Seguro dos disparos: reduz o risco de bloqueio do número.
 * Vale só para números com o Anti-Spam ligado (Configurações do bot). Com o Anti-Spam
 * desligado, nada aqui se aplica e os envios seguem sem restrição.
 *
 * - Janela de horário: segunda a sábado, 9h às 19h (Brasília). Fora dela, o envio espera.
 * - Limite diário com aquecimento: número novo envia pouco e vai subindo.
 * - Ritmo humano: 10 a 40 s entre mensagens e uma pausa maior a cada lote.
 */

const TZ = "America/Sao_Paulo";
export const WINDOW_START_HOUR = 9;
export const WINDOW_END_HOUR = 19; // até 18:59

/** Aquecimento: idade do número conectado -> teto de mensagens por dia. */
const RAMP: { untilDays: number; cap: number }[] = [
    { untilDays: 7, cap: 50 },
    { untilDays: 14, cap: 150 },
    { untilDays: 21, cap: 300 },
];
const MATURE_CAP = 500;

export const BATCH_SIZE = 25;
/** Taxa máxima de números sem WhatsApp antes de a campanha parar sozinha (a partir de MIN_CHECKED). */
export const MAX_INVALID_RATE = 0.15;
export const MIN_CHECKED = 30;
export const MAX_CONSECUTIVE_ERRORS = 5;

export interface SafeMode {
    dailyCap: number;
    ageDays: number;
}

export type Gate = { ok: true } | { ok: false; reason: "window" | "cap"; resumeAt: Date };

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export { sleepMs };

function localParts(d: Date) {
    const f = new Intl.DateTimeFormat("en-US", {
        timeZone: TZ, weekday: "short", hour: "numeric", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    });
    const o: Record<string, string> = {};
    for (const p of f.formatToParts(d)) o[p.type] = p.value;
    return { weekday: o.weekday, hour: Number(o.hour), day: `${o.year}-${o.month}-${o.day}` };
}

export function dayKey(d: Date = new Date()): string {
    return localParts(d).day;
}

export function inSendWindow(d: Date = new Date()): boolean {
    const p = localParts(d);
    return p.weekday !== "Sun" && p.hour >= WINDOW_START_HOUR && p.hour < WINDOW_END_HOUR;
}

/** Próximo instante (em passos de 10 min) dentro da janela; com `nextDay` exige outro dia. */
export function nextOpening(from: Date = new Date(), nextDay = false): Date {
    const today = dayKey(from);
    let t = from.getTime();
    for (let i = 0; i < 8 * 144; i++) {
        t += 10 * 60 * 1000;
        const d = new Date(t);
        if (nextDay && dayKey(d) === today) continue;
        if (inSendWindow(d)) return d;
    }
    return new Date(t);
}

/** Retorna o Modo Seguro da sessão, ou null quando o Anti-Spam está desligado. */
export async function getSafeMode(sessionId: string): Promise<SafeMode | null> {
    const s = await prisma.session.findUnique({
        where: { sessionId },
        select: { createdAt: true, botConfig: { select: { antiSpamEnabled: true } } },
    });
    if (!s) return null;
    if (s.botConfig && !s.botConfig.antiSpamEnabled) return null; // sem configuração salva = ligado

    const ageDays = Math.floor((Date.now() - s.createdAt.getTime()) / 86_400_000);
    const step = RAMP.find((r) => ageDays < r.untilDays);
    return { dailyCap: step ? step.cap : MATURE_CAP, ageDays };
}

export async function sentToday(sessionId: string): Promise<number> {
    const row = await prisma.sendDaily.findUnique({ where: { sessionId_day: { sessionId, day: dayKey() } } });
    return row?.count ?? 0;
}

export async function addSentToday(sessionId: string, n = 1): Promise<void> {
    await prisma.sendDaily.upsert({
        where: { sessionId_day: { sessionId, day: dayKey() } },
        create: { sessionId, day: dayKey(), count: n },
        update: { count: { increment: n } },
    });
}

/** Pode enviar agora? Se não, diz o motivo e quando volta. */
export async function safeGate(sessionId: string, safe: SafeMode): Promise<Gate> {
    if (!inSendWindow()) return { ok: false, reason: "window", resumeAt: nextOpening() };
    if ((await sentToday(sessionId)) >= safe.dailyCap) return { ok: false, reason: "cap", resumeAt: nextOpening(new Date(), true) };
    return { ok: true };
}

/** 10 a 40 segundos entre mensagens. */
export function humanDelayMs(minMs = 10_000): number {
    return Math.max(minMs, 10_000) + Math.floor(Math.random() * 30_000);
}

/** 2 a 5 minutos de pausa entre lotes. */
export function batchPauseMs(): number {
    return 120_000 + Math.floor(Math.random() * 180_000);
}

export function gateMessage(g: Extract<Gate, { ok: false }>): string {
    const when = g.resumeAt.toLocaleString("pt-BR", { timeZone: TZ, weekday: "long", hour: "2-digit", minute: "2-digit" });
    return g.reason === "cap"
        ? `Limite diário do Modo Seguro atingido. O restante continua automaticamente (${when}).`
        : `Fora do horário seguro (seg a sáb, ${WINDOW_START_HOUR}h às ${WINDOW_END_HOUR}h). O restante continua automaticamente (${when}).`;
}
