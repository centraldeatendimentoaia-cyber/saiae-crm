"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import moment from "moment-timezone";
import { Pause, Pencil, Play, Plus, Repeat2, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { VariantsEditor } from "@/components/social/variants-editor";
import { useSocial } from "@/components/social/social-context";
import { DAYS_SHORT, PostType, Series, SeriesVariant, TZ, accountColor, accountLabel, api, jsonInit, mediaSrc } from "@/components/social/types";

const MAX_CAPTION = { instagram: 2200, facebook: 63206 } as const;
const STATUS = {
    ACTIVE: { label: "Ativa", variant: "default" },
    PAUSED: { label: "Pausada", variant: "outline" },
    ENDED: { label: "Encerrada", variant: "secondary" },
} as const;
const emptyVariant = (): SeriesVariant => ({ caption: "", mediaIds: [] });
const today = () => moment.tz(TZ).format("YYYY-MM-DD");

/** Criar série (painel lateral). */
function NewSeries({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
    const { accounts, filter } = useSocial();
    const [name, setName] = useState("");
    const [accountIds, setAccountIds] = useState<string[]>([]);
    const [type, setType] = useState<PostType>("FEED");
    const [weekdays, setWeekdays] = useState<number[]>([]);
    const [time, setTime] = useState("10:00");
    const [startDate, setStartDate] = useState(today());
    const [endMode, setEndMode] = useState<"count" | "date">("count");
    const [count, setCount] = useState("8");
    const [endDate, setEndDate] = useState("");
    const [variants, setVariants] = useState<SeriesVariant[]>([emptyVariant()]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setName(""); setType("FEED"); setWeekdays([]); setTime("10:00"); setStartDate(today());
        setEndMode("count"); setCount("8"); setEndDate(""); setVariants([emptyVariant()]);
        setAccountIds(filter !== "all" ? [filter] : accounts.length === 1 ? [accounts[0].id] : []);
    }, [open, accounts, filter]);

    const selected = accounts.filter((a) => accountIds.includes(a.id));
    const limit = selected.length ? Math.min(...selected.map((a) => MAX_CAPTION[a.provider])) : MAX_CAPTION.instagram;
    const suggested = useMemo(() => [...new Set(selected.flatMap((a) => a.postingTimes))].sort(), [selected]);

    const valid = name.trim() && accountIds.length > 0 && weekdays.length > 0 && /^\d{2}:\d{2}$/.test(time) && variants.every((v) => v.mediaIds.length > 0)
        && (endMode === "count" ? Number(count) >= 1 : !!endDate);

    const save = async () => {
        setSaving(true);
        try {
            const r = await api<{ message: string }>("/api/social/series", jsonInit("POST", {
                name, accountIds, type, weekdays, time, startDate,
                maxCount: endMode === "count" ? Number(count) : null,
                endDate: endMode === "date" ? endDate : null,
                variants,
            }));
            toast.success(r.message);
            onDone();
            onClose();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao criar a série");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
                <SheetHeader>
                    <SheetTitle>Nova série</SheetTitle>
                    <SheetDescription>Posta sozinha nos dias e horário escolhidos. As próximas 8 semanas aparecem no calendário.</SheetDescription>
                </SheetHeader>
                <div className="space-y-5 px-4 pb-6">
                    <div className="space-y-2"><Label>Nome da série</Label><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Dica da terça" /></div>

                    <div className="space-y-2">
                        <Label>Contas</Label>
                        <div className="flex flex-wrap gap-2">
                            {accounts.map((a) => {
                                const on = accountIds.includes(a.id);
                                return (
                                    <button key={a.id} type="button" onClick={() => setAccountIds((x) => (on ? x.filter((i) => i !== a.id) : [...x, a.id]))}
                                        className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${on ? "border-primary bg-primary/10" : "opacity-70 hover:opacity-100"}`}>
                                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: accountColor(a) }} />{accountLabel(a)}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Tipo</Label>
                        <Select value={type} onValueChange={(v) => { setType(v as PostType); if (v === "STORY") setVariants((vs) => vs.map((x) => ({ ...x, mediaIds: x.mediaIds.slice(0, 1) }))); }}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="FEED">Feed (1 a 10 imagens)</SelectItem>
                                <SelectItem value="STORY">Story (1 imagem)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>Repetir em</Label>
                        <div className="flex gap-1.5">
                            {DAYS_SHORT.map((d, i) => {
                                const on = weekdays.includes(i);
                                return (
                                    <button key={d} type="button" onClick={() => setWeekdays((w) => (on ? w.filter((x) => x !== i) : [...w, i].sort()))}
                                        className={`h-10 flex-1 rounded-md border text-sm capitalize ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{d}</button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Horário (Brasília)</Label>
                            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
                            {suggested.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 text-xs">
                                    {suggested.map((t) => <button key={t} type="button" onClick={() => setTime(t)} className="rounded-full border px-2 py-0.5 hover:bg-accent">{t}</button>)}
                                </div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label>Começa em</Label>
                            <input type="date" value={startDate} min={today()} onChange={(e) => setStartDate(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Termina</Label>
                        <div className="flex items-center gap-2">
                            <Select value={endMode} onValueChange={(v) => setEndMode(v as "count" | "date")}>
                                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="count">Após N postagens</SelectItem>
                                    <SelectItem value="date">Em uma data</SelectItem>
                                </SelectContent>
                            </Select>
                            {endMode === "count"
                                ? <Input type="number" min={1} max={200} value={count} onChange={(e) => setCount(e.target.value)} className="w-24" />
                                : <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" />}
                        </div>
                        <p className="text-xs text-muted-foreground">Toda série precisa de um fim, para não postar sozinha para sempre. Dá para encerrar antes a qualquer momento.</p>
                    </div>

                    <div className="space-y-2">
                        <Label>Conteúdo</Label>
                        <VariantsEditor type={type} variants={variants} onChange={setVariants} captionLimit={limit} />
                    </div>

                    <Button className="w-full" disabled={!valid || saving} onClick={save}>{saving ? "Criando…" : "Criar série"}</Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}

/** Editar nome e conteúdo de uma série existente. */
function EditSeries({ series, onClose, onDone }: { series: Series | null; onClose: () => void; onDone: () => void }) {
    const { accounts } = useSocial();
    const [name, setName] = useState("");
    const [variants, setVariants] = useState<SeriesVariant[]>([]);
    const [applyToFuture, setApplyToFuture] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!series) return;
        setName(series.name);
        setVariants(series.variants.map((v) => ({ ...v })));
        setApplyToFuture(true);
    }, [series]);

    if (!series) return null;
    const mine = accounts.filter((a) => series.accountIds.includes(a.id));
    const limit = mine.length ? Math.min(...mine.map((a) => MAX_CAPTION[a.provider])) : MAX_CAPTION.instagram;
    const valid = name.trim() && variants.length > 0 && variants.every((v) => v.mediaIds.length > 0);

    const save = async () => {
        setSaving(true);
        try {
            const r = await api<{ message: string }>(`/api/social/series/${series.id}`, jsonInit("PATCH", { name, variants, applyToFuture }));
            toast.success(r.message);
            onDone();
            onClose();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao salvar");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Sheet open onOpenChange={(o) => !o && onClose()}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
                <SheetHeader>
                    <SheetTitle>Editar série</SheetTitle>
                    <SheetDescription>Dias, horário e contas não mudam. Para isso, encerre esta série e crie outra.</SheetDescription>
                </SheetHeader>
                <div className="space-y-5 px-4 pb-6">
                    <div className="space-y-2"><Label>Nome</Label><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></div>
                    <div className="space-y-2"><Label>Conteúdo</Label><VariantsEditor type={series.type} variants={variants} onChange={setVariants} captionLimit={limit} /></div>
                    <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" className="mt-1" checked={applyToFuture} onChange={(e) => setApplyToFuture(e.target.checked)} />
                        Aplicar também às postagens futuras já geradas (as já publicadas não mudam)
                    </label>
                    <Button className="w-full" disabled={!valid || saving} onClick={save}>{saving ? "Salvando…" : "Salvar"}</Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}

export default function SeriesPage() {
    const { accounts, version, bump, filter } = useSocial();
    const [list, setList] = useState<Series[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [editing, setEditing] = useState<Series | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setList((await api<{ data: Series[] }>("/api/social/series")).data);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao carregar as séries");
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load, version]);

    const act = async (s: Series, status: "PAUSED" | "ACTIVE" | "ENDED") => {
        if (status === "ENDED" && !confirm("Encerrar a série? As postagens futuras ainda não enviadas serão removidas. O que já foi publicado continua no histórico.")) return;
        try {
            const r = await api<{ message: string }>(`/api/social/series/${s.id}`, jsonInit("PATCH", { status }));
            toast.success(r.message);
            bump();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha");
        }
    };
    const remove = async (s: Series) => {
        if (!confirm("Excluir a série e as postagens futuras dela? O que já foi publicado continua no histórico.")) return;
        try {
            await api(`/api/social/series/${s.id}`, { method: "DELETE" });
            bump();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao excluir");
        }
    };

    const shown = filter === "all" ? list : list.filter((s) => s.accountIds.includes(filter));

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">Posts que se repetem sozinhos, como “toda terça às 10h”.</p>
                <Button onClick={() => setCreating(true)} disabled={accounts.length === 0}><Plus className="mr-2 h-4 w-4" />Nova série</Button>
            </div>

            {!loading && shown.length === 0 && (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    <Repeat2 className="mx-auto mb-2 h-6 w-6" />Nenhuma série ainda. Crie uma para o que você posta sempre no mesmo dia.
                </div>
            )}

            {shown.map((s) => {
                const accs = accounts.filter((a) => s.accountIds.includes(a.id));
                const info = STATUS[s.status];
                return (
                    <Card key={s.id}>
                        <CardContent className="space-y-3 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0 space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="font-semibold">{s.name}</h3>
                                        <Badge variant={info.variant}>{info.label}</Badge>
                                        <span className="text-xs text-muted-foreground">{s.type === "STORY" ? "Story" : "Feed"}</span>
                                    </div>
                                    <p className="text-sm">{s.rule}</p>
                                    <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                                        {accs.map((a) => <span key={a.id} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: accountColor(a) }} />{accountLabel(a)}</span>)}
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {s.status === "ACTIVE" && <Button size="sm" variant="outline" onClick={() => act(s, "PAUSED")}><Pause className="mr-1.5 h-4 w-4" />Pausar</Button>}
                                    {s.status === "PAUSED" && <Button size="sm" variant="outline" onClick={() => act(s, "ACTIVE")}><Play className="mr-1.5 h-4 w-4" />Retomar</Button>}
                                    {s.status !== "ENDED" && <Button size="sm" variant="outline" onClick={() => setEditing(s)}><Pencil className="mr-1.5 h-4 w-4" />Editar</Button>}
                                    {s.status !== "ENDED" && <Button size="sm" variant="outline" onClick={() => act(s, "ENDED")}><Square className="mr-1.5 h-4 w-4" />Encerrar</Button>}
                                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(s)}><Trash2 className="h-4 w-4" /></Button>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>{s.stats.published} publicada(s)</span>
                                <span>{s.stats.scheduled} agendada(s)</span>
                                {s.stats.failed > 0 && <span className="text-destructive">{s.stats.failed} com falha</span>}
                                {s.maxCount && <span>{s.generatedCount} de {s.maxCount} geradas</span>}
                                {s.endDate && <span>até {moment(s.endDate).format("DD/MM/YYYY")}</span>}
                                {s.nextAt && s.status === "ACTIVE" && <span>próxima: {moment.tz(s.nextAt, TZ).format("DD/MM [às] HH:mm")}</span>}
                            </div>

                            <div className="flex flex-wrap gap-1.5">
                                {s.variants.map((v, i) => (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img key={i} src={mediaSrc(v.mediaIds[0])} alt={`Variação ${i + 1}`} title={v.caption || `Variação ${i + 1}`} className="h-10 w-10 rounded border object-cover" />
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                );
            })}

            <NewSeries open={creating} onClose={() => setCreating(false)} onDone={bump} />
            <EditSeries series={editing} onClose={() => setEditing(null)} onDone={bump} />
        </div>
    );
}
