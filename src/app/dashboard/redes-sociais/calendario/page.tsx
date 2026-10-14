"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import moment from "moment-timezone";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CalendarView, CalView, rangeFor } from "@/components/social/calendar-view";
import { useSocial } from "@/components/social/social-context";
import { Post, TZ, api, jsonInit, longDay, monthYear, shortDate } from "@/components/social/types";

const VIEWS: { id: CalView; label: string }[] = [
    { id: "month", label: "Mês" },
    { id: "week", label: "Semana" },
    { id: "day", label: "Dia" },
    { id: "agenda", label: "Agenda" },
];

function title(view: CalView, c: moment.Moment) {
    if (view === "day") return longDay(c);
    if (view === "week") {
        const a = c.clone().startOf("week"), b = a.clone().add(6, "day");
        return `${shortDate(a)} a ${shortDate(b)} de ${b.year()}`;
    }
    return monthYear(c);
}

export default function CalendarioPage() {
    const { filter, openCreate, openEdit, version, bump, accounts } = useSocial();
    const [view, setView] = useState<CalView>("month");
    const [cursor, setCursor] = useState(() => moment.tz(TZ));
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(false);

    // no celular a lista por dia é mais útil que a grade
    useEffect(() => {
        try {
            const saved = localStorage.getItem("social:view") as CalView | null;
            if (saved && VIEWS.some((v) => v.id === saved)) return setView(saved);
        } catch { /* sem localStorage */ }
        if (window.innerWidth < 640) setView("agenda");
    }, []);
    const changeView = (v: CalView) => {
        setView(v);
        try { localStorage.setItem("social:view", v); } catch { /* ok */ }
    };

    const range = useMemo(() => rangeFor(view, cursor), [view, cursor]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const q = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString(), limit: "1000" });
            if (filter !== "all") q.set("accountId", filter);
            setPosts((await api<{ data: Post[] }>(`/api/social/posts?${q}`)).data);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao carregar o calendário");
        } finally {
            setLoading(false);
        }
    }, [range, filter]);

    useEffect(() => { load(); }, [load, version]);

    // quem está esperando na fila aparece sozinho como publicada/falhou sem apertar nada
    useEffect(() => {
        if (!posts.some((p) => p.status === "PENDING" || p.status === "PUBLISHING")) return;
        const t = setInterval(load, 60_000);
        return () => clearInterval(t);
    }, [posts, load]);

    const step = (dir: -1 | 1) => {
        const unit = view === "day" ? "day" : view === "week" ? "week" : "month";
        setCursor((c) => c.clone().add(dir, unit));
    };

    const move = async (p: Post, to: moment.Moment) => {
        if (to.isBefore(moment.tz(TZ).subtract(5, "minute"))) return toast.error("Não dá para mover para o passado.");
        const before = posts;
        setPosts((list) => list.map((x) => (x.id === p.id ? { ...x, publishAt: to.toISOString() } : x))); // otimista
        try {
            await api(`/api/social/posts/${p.id}`, jsonInit("PATCH", { publishAt: to.toISOString() }));
            toast.success(`Reagendada para ${to.format("DD/MM [às] HH:mm")}.`);
            bump();
        } catch (e) {
            setPosts(before);
            toast.error(e instanceof Error ? e.message : "Não foi possível reagendar");
        }
    };

    const counts = useMemo(() => {
        const c = { PENDING: 0, PUBLISHED: 0, FAILED: 0 } as Record<string, number>;
        for (const p of posts) if (p.status in c) c[p.status]++;
        return c;
    }, [posts]);

    if (!accounts.length) {
        return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Conecte uma conta na aba <b>Contas</b> para começar a agendar.</p>;
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></Button>
                    <Button variant="outline" size="icon" onClick={() => step(1)}><ChevronRight className="h-4 w-4" /></Button>
                    <Button variant="outline" size="sm" onClick={() => setCursor(moment.tz(TZ))}>Hoje</Button>
                    <h2 className="ml-2 text-base font-semibold capitalize sm:text-lg">{title(view, cursor)}</h2>
                </div>
                <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-md border p-0.5">
                        {VIEWS.map((v) => (
                            <button key={v.id} type="button" onClick={() => changeView(v.id)} className={`rounded px-2.5 py-1 text-sm ${view === v.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{v.label}</button>
                        ))}
                    </div>
                    <Button variant="outline" size="icon" onClick={load} disabled={loading} title="Atualizar"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
                </div>
            </div>

            <p className="text-xs text-muted-foreground">
                {counts.PENDING} agendada(s) · {counts.PUBLISHED} publicada(s){counts.FAILED > 0 && <> · <span className="text-destructive">{counts.FAILED} com falha</span></>} neste período
                {view !== "agenda" && " · arraste uma postagem agendada para mudar o dia ou a hora"}
            </p>

            <CalendarView
                view={view}
                cursor={cursor}
                posts={posts}
                onSelect={(p) => openEdit(p)}
                onCreate={(at) => openCreate({ date: at.toISOString() })}
                onMove={move}
                onOpenDay={(d) => { setCursor(d); changeView("day"); }}
            />
        </div>
    );
}
