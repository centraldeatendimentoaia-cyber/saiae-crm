import { TZ_SAO_PAULO } from "@/modules/atendimento-comum/tempo";
import moment from "moment-timezone";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { PostType, Provider, asRecord, parseClock } from "./validate";

export const TZ = TZ_SAO_PAULO;
/** Quanto à frente o sistema mantém postagens geradas. */
export const HORIZON_DAYS = 56;
export const MAX_ACCOUNTS = 5;
export const MAX_VARIANTS = 12;
export const MAX_OCCURRENCES = 200;
const MAX_CAPTION: Record<Provider, number> = { instagram: 2200, facebook: 63206 };

export type Variant = {
    caption: string;
    mediaIds: string[];
};

export interface SeriesRule {
    weekdays: number[];
    time: string; // HH:MM
    startDate: string; // YYYY-MM-DD
    endDate: string | null; // YYYY-MM-DD, inclusive
}

export interface SeriesInput extends SeriesRule {
    name: string;
    accountIds: string[];
    type: PostType;
    maxCount: number | null;
    variants: Variant[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (v: unknown): v is string => typeof v === "string" && DAY_RE.test(v) && moment(v, "YYYY-MM-DD", true).isValid();

/** Valida só o conteúdo (variações), usado ao criar e ao editar a série. */
export function parseVariants(raw: unknown, type: PostType, providers: Provider[]): { error: string } | { value: Variant[] } {
    if (!Array.isArray(raw) || raw.length < 1) return { error: "Adicione pelo menos uma variação (imagens e legenda)." };
    if (raw.length > MAX_VARIANTS) return { error: `No máximo ${MAX_VARIANTS} variações.` };
    const limit = Math.min(...providers.map((p) => MAX_CAPTION[p]));
    const out: Variant[] = [];
    for (const [i, v] of raw.entries()) {
        const vr = asRecord(v);
        const mediaIds: string[] = Array.isArray(vr.mediaIds) ? vr.mediaIds.filter((x): x is string => typeof x === "string") : [];
        const n = `Variação ${i + 1}`;
        if (mediaIds.length < 1) return { error: `${n}: escolha pelo menos uma imagem.` };
        if (new Set(mediaIds).size !== mediaIds.length) return { error: `${n}: imagem repetida.` };
        if (type === "STORY" && mediaIds.length !== 1) return { error: `${n}: Story aceita exatamente 1 imagem.` };
        if (mediaIds.length > 10) return { error: `${n}: no máximo 10 imagens.` };
        const caption = type === "STORY" ? "" : typeof vr.caption === "string" ? vr.caption.trim() : "";
        if (caption.length > limit) return { error: `${n}: legenda grande demais (máx. ${limit} caracteres).` };
        out.push({ caption, mediaIds });
    }
    return { value: out };
}

/** Corpo de POST /api/social/series. `today` (YYYY-MM-DD) existe para os testes. */
export function parseSeries(body: unknown, providers: Provider[], today = moment.tz(TZ).format("YYYY-MM-DD")): { error: string } | { value: SeriesInput } {
    const b = asRecord(body);
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "";
    if (!name) return { error: "Dê um nome para a série." };

    const accountIds: string[] = Array.isArray(b.accountIds) ? [...new Set<string>(b.accountIds.filter((x): x is string => typeof x === "string"))] : [];
    if (accountIds.length < 1) return { error: "Escolha pelo menos uma conta." };
    if (accountIds.length > MAX_ACCOUNTS) return { error: `No máximo ${MAX_ACCOUNTS} contas por série.` };

    const type = b.type;
    if (type !== "FEED" && type !== "STORY") return { error: "Tipo inválido (use FEED ou STORY)." };

    const weekdays: number[] = Array.isArray(b.weekdays) ? [...new Set<number>(b.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
    if (weekdays.length < 1) return { error: "Escolha pelo menos um dia da semana." };

    const time = b.time;
    if (typeof time !== "string" || parseClock(time) === null) return { error: "Horário inválido (use HH:MM)." };

    const startDate = b.startDate;
    if (!validDay(startDate)) return { error: "Data de início inválida." };
    if (startDate < today) return { error: "A data de início já passou." };

    const endRaw = b.endDate ?? null;
    if (endRaw !== null && !validDay(endRaw)) return { error: "Data final inválida." };
    const endDate = endRaw as string | null;
    if (endDate !== null && endDate < startDate) return { error: "A data final é antes do início." };
    if (endDate !== null && moment(endDate).diff(moment(startDate), "day") > 366) return { error: "A série pode durar no máximo 1 ano." };

    const maxRaw = b.maxCount ?? null;
    if (maxRaw !== null && (typeof maxRaw !== "number" || !Number.isInteger(maxRaw) || maxRaw < 1 || maxRaw > MAX_OCCURRENCES)) return { error: `Número de postagens deve ficar entre 1 e ${MAX_OCCURRENCES}.` };
    const maxCount = maxRaw as number | null;
    if (endDate === null && maxCount === null) return { error: "Defina quando a série termina: uma data final ou um número de postagens." };

    const variants = parseVariants(b.variants, type, providers);
    if ("error" in variants) return variants;

    return { value: { name, accountIds, type, weekdays, time, startDate, endDate, maxCount, variants: variants.value } };
}

/** Texto curto da regra: "toda terça e quinta às 10:00". */
export function describeRule(r: Pick<SeriesRule, "weekdays" | "time">): string {
    const names = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
    const days = r.weekdays.map((d) => names[d]);
    const list = days.length > 1 ? `${days.slice(0, -1).join(", ")} e ${days[days.length - 1]}` : days[0];
    return `toda ${list} às ${r.time}`;
}

/**
 * Datas de publicação da regra no intervalo (after, until], em ordem. `after` é exclusivo.
 * Respeita a data de início e a data final (inclusive) e o fuso de Brasília.
 */
export function computeOccurrences(rule: SeriesRule, after: Date, until: Date): Date[] {
    const [hh, mm] = rule.time.split(":").map(Number);
    const out: Date[] = [];
    const first = moment.tz(after, TZ).startOf("day");
    const startDay = moment.tz(rule.startDate, "YYYY-MM-DD", TZ);
    const day = moment.max(first, startDay).clone();
    const lastDay = moment.tz(until, TZ).startOf("day");
    const endDay = rule.endDate ? moment.tz(rule.endDate, "YYYY-MM-DD", TZ) : null;

    for (; !day.isAfter(lastDay) && out.length < 1000; day.add(1, "day")) {
        if (endDay && day.isAfter(endDay)) break;
        if (!rule.weekdays.includes(day.day())) continue;
        const at = day.clone().hour(hh).minute(mm).second(0).millisecond(0);
        if (at.isAfter(after) && !at.isAfter(until)) out.push(at.toDate());
    }
    return out;
}

interface SeriesRow {
    id: string;
    userId: string;
    accountIds: unknown;
    type: string;
    weekdays: unknown;
    time: string;
    startDate: string;
    endDate: string | null;
    maxCount: number | null;
    variants: unknown;
    status: string;
    generatedCount: number;
    generatedThrough: Date;
}

/**
 * Gera as postagens da série até o horizonte (8 semanas). Seguro para rodar de novo: só cria ocorrências
 * depois de `generatedThrough`, então o que o usuário pulou ou apagou não volta.
 * Devolve quantas postagens foram criadas.
 */
export async function generateForSeries(series: SeriesRow, now = new Date()): Promise<number> {
    if (series.status !== "ACTIVE") return 0;

    const wanted = series.accountIds as string[];
    const alive = await prisma.socialAccount.findMany({ where: { id: { in: wanted }, userId: series.userId }, select: { id: true } });
    if (!alive.length) {
        await prisma.postSeries.updateMany({ where: { id: series.id, status: "ACTIVE" }, data: { status: "ENDED" } });
        return 0;
    }

    const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
    const after = new Date(Math.max(series.generatedThrough.getTime(), now.getTime()));
    const rule: SeriesRule = { weekdays: series.weekdays as number[], time: series.time, startDate: series.startDate, endDate: series.endDate };

    const remaining = series.maxCount === null ? Infinity : Math.max(series.maxCount - series.generatedCount, 0);
    const dates = computeOccurrences(rule, after, horizon).slice(0, remaining);
    const variants = series.variants as Variant[];

    // acabou: contagem batida ou a data final já cabe inteira no horizonte
    const endsByCount = series.maxCount !== null && series.generatedCount + dates.length >= series.maxCount;
    const endsByDate = series.endDate !== null && moment.tz(series.endDate, "YYYY-MM-DD", TZ).endOf("day").isBefore(horizon);
    const finished = endsByCount || endsByDate;

    const rows = dates.flatMap((publishAt, k) => {
        const index = series.generatedCount + k;
        const v = variants[index % variants.length];
        return alive.map((a) => ({
            userId: series.userId, accountId: a.id, type: series.type, caption: v.caption || null, mediaIds: v.mediaIds,
            publishAt, groupId: series.id, seriesId: series.id, seriesIndex: index, status: "PENDING",
        }));
    });

    // "claim" pela contagem: se outra rodada gerou no meio, esta desiste em vez de duplicar
    return prisma.$transaction(async (tx) => {
        const claimed = await tx.postSeries.updateMany({
            where: { id: series.id, status: "ACTIVE", generatedCount: series.generatedCount },
            data: { generatedCount: series.generatedCount + dates.length, generatedThrough: finished && dates.length ? dates[dates.length - 1] : horizon, status: finished ? "ENDED" : "ACTIVE" },
        });
        if (claimed.count !== 1) return 0;
        if (rows.length) await tx.scheduledPost.createMany({ data: rows });
        return rows.length;
    });
}

/** Mantém o horizonte de todas as séries ativas. Chamado na subida e a cada hora. */
export async function extendAllSeries(): Promise<void> {
    try {
        const active = await prisma.postSeries.findMany({ where: { status: "ACTIVE" } });
        for (const s of active) {
            const n = await generateForSeries(s as SeriesRow);
            if (n) logger.info("Social", `Série ${s.id}: ${n} postagem(ns) geradas`);
        }
    } catch (err) {
        logger.error("Social", "Falha ao estender séries:", err);
    }
}
