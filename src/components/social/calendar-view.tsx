"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import moment from "moment-timezone";
import { Repeat2 } from "lucide-react";
import { DAYS_SHORT, Post, STATUS_INFO, TZ, accountColor, accountName, longDay, mediaSrc, postTypeLabel } from "./types";

export type CalView = "month" | "week" | "day" | "agenda";

const WEEKDAYS = DAYS_SHORT;
const HOUR_H = 56;

/** Intervalo [from, to) coberto pela tela — usado também para buscar as postagens. */
export function rangeFor(view: CalView, cursor: moment.Moment): { from: moment.Moment; to: moment.Moment } {
    const c = cursor.clone().tz(TZ);
    if (view === "day") return { from: c.clone().startOf("day"), to: c.clone().add(1, "day").startOf("day") };
    if (view === "week") {
        const from = c.clone().startOf("week");
        return { from, to: from.clone().add(7, "day") };
    }
    // mês e agenda: mês inteiro, completado até semanas fechadas (a agenda só lista os dias do mês)
    const from = c.clone().startOf("month").startOf("week");
    return { from, to: from.clone().add(42, "day") };
}

interface Props {
    view: CalView;
    cursor: moment.Moment;
    posts: Post[];
    onSelect: (p: Post) => void;
    onCreate: (at: moment.Moment) => void;
    onMove: (p: Post, to: moment.Moment) => void;
    onOpenDay: (day: moment.Moment) => void;
}

const when = (p: Post) => moment.tz(p.publishAt as string, TZ);

function Chip({ post, compact, onSelect, onDragStart }: { post: Post; compact?: boolean; onSelect: (p: Post) => void; onDragStart: (p: Post) => void }) {
    const color = accountColor(post.account);
    const draggable = post.status === "PENDING";
    const info = STATUS_INFO[post.status];
    return (
        <button
            type="button"
            draggable={draggable}
            onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", post.id);
                e.dataTransfer.effectAllowed = "move";
                onDragStart(post);
            }}
            onClick={(e) => { e.stopPropagation(); onSelect(post); }}
            title={`${post.account ? accountName(post.account) : "conta removida"} · ${postTypeLabel(post)} · ${info.label}${post.caption ? "\n" + post.caption : ""}`}
            className={`group flex w-full items-center gap-1.5 rounded border border-l-4 bg-card px-1.5 text-left text-xs transition hover:bg-accent ${compact ? "py-0.5" : "py-1"} ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${post.status === "FAILED" ? "border-destructive/60" : ""}`}
            style={{ borderLeftColor: color }}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaSrc(post.mediaIds[0])} alt="" className={`${compact ? "h-4 w-4" : "h-6 w-6"} shrink-0 rounded-sm object-cover`} draggable={false} />
            <span className="font-medium tabular-nums">{when(post).format("HH:mm")}</span>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${info.dot}`} />
            <span className="truncate text-muted-foreground">{post.type === "STORY" ? "Story" : post.account ? accountName(post.account) : ""}</span>
            {post.seriesId && !compact && <Repeat2 className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/60" />}
        </button>
    );
}

export function CalendarView({ view, cursor, posts, onSelect, onCreate, onMove, onOpenDay }: Props) {
    const dragging = useRef<Post | null>(null);
    const [over, setOver] = useState<string | null>(null);
    const scroller = useRef<HTMLDivElement>(null);
    const now = moment.tz(TZ);

    const byDay = useMemo(() => {
        const map = new Map<string, Post[]>();
        for (const p of posts) {
            if (!p.publishAt) continue;
            const key = when(p).format("YYYY-MM-DD");
            map.set(key, [...(map.get(key) || []), p]);
        }
        for (const list of map.values()) list.sort((a, b) => +when(a) - +when(b));
        return map;
    }, [posts]);

    useEffect(() => {
        if (view === "week" || view === "day") scroller.current?.scrollTo({ top: HOUR_H * 7 });
    }, [view]);

    const drop = (target: moment.Moment, keepTime: boolean) => {
        const p = dragging.current;
        dragging.current = null;
        setOver(null);
        if (!p || !p.publishAt) return;
        const t = when(p);
        const to = keepTime ? target.clone().hour(t.hour()).minute(t.minute()).second(0) : target.clone().minute(0).second(0);
        if (to.isSame(t)) return;
        onMove(p, to);
    };

    const dnd = (key: string, target: moment.Moment, keepTime: boolean) => ({
        onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(key); },
        onDragLeave: () => setOver((o) => (o === key ? null : o)),
        onDrop: (e: React.DragEvent) => { e.preventDefault(); drop(target, keepTime); },
    });

    // ---------- AGENDA (lista por dia) ----------
    if (view === "agenda") {
        const month = cursor.clone().tz(TZ);
        const days = [...byDay.entries()]
            .filter(([k]) => moment.tz(k, TZ).isSame(month, "month"))
            .sort(([a], [b]) => a.localeCompare(b));
        if (!days.length) return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma postagem neste mês.</p>;
        return (
            <div className="space-y-4">
                {days.map(([k, list]) => {
                    const d = moment.tz(k, TZ);
                    return (
                        <section key={k}>
                            <h3 className={`mb-1.5 text-sm font-semibold capitalize ${d.isSame(now, "day") ? "text-primary" : ""}`}>{longDay(d)}</h3>
                            <div className="space-y-1.5">
                                {list.map((p) => <Chip key={p.id} post={p} onSelect={onSelect} onDragStart={() => {}} />)}
                            </div>
                        </section>
                    );
                })}
            </div>
        );
    }

    // ---------- MÊS ----------
    if (view === "month") {
        const { from } = rangeFor("month", cursor);
        const days = Array.from({ length: 42 }, (_, i) => from.clone().add(i, "day"));
        const month = cursor.clone().tz(TZ);
        return (
            <div className="overflow-hidden rounded-lg border">
                <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium uppercase text-muted-foreground">
                    {WEEKDAYS.map((w) => <div key={w} className="py-1.5">{w}</div>)}
                </div>
                <div className="grid grid-cols-7">
                    {days.map((d) => {
                        const key = d.format("YYYY-MM-DD");
                        const list = byDay.get(key) || [];
                        const past = d.clone().endOf("day").isBefore(now);
                        const inMonth = d.isSame(month, "month");
                        return (
                            <div
                                key={key}
                                {...dnd(key, d, true)}
                                onClick={() => !past && onCreate(d.clone().hour(Math.max(9, now.isSame(d, "day") ? now.hour() + 1 : 9)).minute(0))}
                                className={`min-h-24 border-b border-r p-1 sm:min-h-28 ${inMonth ? "" : "bg-muted/20 text-muted-foreground"} ${past ? "" : "cursor-pointer hover:bg-accent/40"} ${over === key ? "bg-primary/10 ring-1 ring-inset ring-primary" : ""}`}
                            >
                                <div className="mb-1 flex items-center justify-between">
                                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${d.isSame(now, "day") ? "bg-primary text-primary-foreground" : ""}`}>{d.date()}</span>
                                </div>
                                <div className="space-y-0.5">
                                    {list.slice(0, 3).map((p) => <Chip key={p.id} post={p} compact onSelect={onSelect} onDragStart={(x) => (dragging.current = x)} />)}
                                    {list.length > 3 && (
                                        <button type="button" onClick={(e) => { e.stopPropagation(); onOpenDay(d); }} className="w-full rounded px-1 text-left text-xs text-muted-foreground hover:underline">
                                            +{list.length - 3} mais
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    // ---------- SEMANA e DIA (grade por hora) ----------
    const { from } = rangeFor(view, cursor);
    const days = Array.from({ length: view === "week" ? 7 : 1 }, (_, i) => from.clone().add(i, "day"));
    const cols = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;
    return (
        <div className="overflow-hidden rounded-lg border">
            <div className="grid border-b bg-muted/40 text-center text-xs" style={{ gridTemplateColumns: cols }}>
                <div />
                {days.map((d) => (
                    <button key={d.format()} type="button" onClick={() => onOpenDay(d)} className={`py-1.5 font-medium capitalize hover:bg-accent ${d.isSame(now, "day") ? "text-primary" : ""}`}>
                        {WEEKDAYS[d.day()]} <span className="tabular-nums">{d.date()}</span>
                    </button>
                ))}
            </div>
            <div ref={scroller} className="max-h-[65vh] overflow-y-auto">
                <div className="grid" style={{ gridTemplateColumns: cols }}>
                    {Array.from({ length: 24 }, (_, h) => (
                        <div key={h} className="contents">
                            <div className="border-b border-r pr-1 pt-0.5 text-right text-[11px] text-muted-foreground tabular-nums" style={{ height: HOUR_H }}>{String(h).padStart(2, "0")}:00</div>
                            {days.map((d) => {
                                const slot = d.clone().hour(h).minute(0).second(0);
                                const key = slot.format("YYYY-MM-DDTHH");
                                const list = (byDay.get(d.format("YYYY-MM-DD")) || []).filter((p) => when(p).hour() === h);
                                const past = slot.clone().add(1, "hour").isBefore(now);
                                return (
                                    <div
                                        key={key}
                                        {...dnd(key, slot, false)}
                                        onClick={() => !past && onCreate(slot.clone().isBefore(now) ? now.clone().add(5, "minute").second(0) : slot)}
                                        className={`space-y-0.5 overflow-hidden border-b border-r p-0.5 ${past ? "bg-muted/20" : "cursor-pointer hover:bg-accent/40"} ${over === key ? "bg-primary/10 ring-1 ring-inset ring-primary" : ""}`}
                                        style={{ minHeight: HOUR_H }}
                                    >
                                        {list.map((p) => <Chip key={p.id} post={p} onSelect={onSelect} onDragStart={(x) => (dragging.current = x)} />)}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
