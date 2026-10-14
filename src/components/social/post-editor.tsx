"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import moment from "moment-timezone";
import { ArrowLeft, ArrowRight, CalendarPlus, Copy, ExternalLink, ImagePlus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSocial } from "./social-context";
import {
    DAYS_SHORT, Post, PostType, STATUS_INFO, TZ, accountColor, accountLabel, accountName, api, fromInputValue, jsonInit, longDay, mediaSrc, toInputValue,
} from "./types";

type Loaded = Post & { groupEditable: number };

const MAX_CAPTION = { instagram: 2200, facebook: 63206 } as const;
const EDITABLE = ["DRAFT", "PENDING"];
const nextHourValue = () => toInputValue(moment.tz(TZ).add(1, "hour").startOf("hour"));

export function PostEditor() {
    const { editor, closeEditor, accounts, signatures, filter, bump, openCreate } = useSocial();
    const open = editor.mode !== "closed";
    const editing = editor.mode === "edit";

    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [loading, setLoading] = useState(false);
    const [accountIds, setAccountIds] = useState<string[]>([]);
    const [type, setType] = useState<PostType>("FEED");
    const [caption, setCaption] = useState("");
    const [media, setMedia] = useState<string[]>([]);
    const [dates, setDates] = useState<string[]>([]);
    const [applyToGroup, setApplyToGroup] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [ratio, setRatio] = useState<number | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    // (re)inicia o formulário sempre que o painel abre ou muda de postagem
    useEffect(() => {
        if (editor.mode === "closed") return;
        setApplyToGroup(false);
        setRatio(null);
        if (editor.mode === "create") {
            const s = editor.seed;
            setLoaded(null);
            setAccountIds(s.accountIds ?? (filter !== "all" ? [filter] : accounts.length === 1 ? [accounts[0].id] : []));
            setType(s.type ?? "FEED");
            setCaption(s.caption ?? "");
            setMedia(s.mediaIds ?? []);
            setDates([s.date ? toInputValue(moment.tz(s.date, TZ)) : nextHourValue()]);
            return;
        }
        let alive = true;
        setLoading(true);
        api<{ data: Loaded }>(`/api/social/posts/${editor.postId}`)
            .then(({ data }) => {
                if (!alive) return;
                setLoaded(data);
                setAccountIds([data.accountId]);
                setType(data.type);
                setCaption(data.caption ?? "");
                setMedia(data.mediaIds);
                setDates(data.publishAt ? [toInputValue(moment.tz(data.publishAt, TZ))] : []);
            })
            .catch((e) => { toast.error(e.message); closeEditor(); })
            .finally(() => alive && setLoading(false));
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor]);

    const readOnly = editing && !!loaded && !EDITABLE.includes(loaded.status);
    const selected = useMemo(() => accounts.filter((a) => accountIds.includes(a.id)), [accounts, accountIds]);
    const limit = selected.length ? Math.min(...selected.map((a) => MAX_CAPTION[a.provider])) : MAX_CAPTION.instagram;
    const suggested = useMemo(() => [...new Set(selected.flatMap((a) => a.postingTimes))].sort(), [selected]);

    // ---------- datas ----------
    const setDate = (i: number, v: string) => setDates((d) => d.map((x, j) => (j === i ? v : x)));
    const lastTime = () => (dates.length ? dates[dates.length - 1].slice(11) : suggested[0] || "10:00");
    const addDate = () => {
        const base = dates.length ? fromInputValue(dates[dates.length - 1]) : moment.tz(TZ).startOf("day").hour(10);
        setDates((d) => [...d, toInputValue(base.clone().add(dates.length ? 1 : 0, "day"))]);
    };
    const addWeekday = (wd: number) => {
        const [h, m] = lastTime().split(":").map(Number);
        const t = moment.tz(TZ).startOf("day").hour(h).minute(m);
        while (t.day() !== wd || t.isBefore(moment.tz(TZ))) t.add(1, "day");
        const v = toInputValue(t);
        setDates((d) => (d.includes(v) ? d : [...d, v]));
    };
    const addWeekly = () => {
        if (!dates.length) return;
        setDates((d) => [...d, toInputValue(fromInputValue(d[d.length - 1]).add(7, "day"))]);
    };
    const applyTime = (t: string) => setDates((d) => (d.length ? d.map((x, j) => (j === d.length - 1 ? x.slice(0, 11) + t : x)) : [toInputValue(moment.tz(TZ).startOf("day").add(1, "day")).slice(0, 11) + t]));

    // ---------- imagens ----------
    const upload = async (files: FileList | null) => {
        if (!files?.length) return;
        setUploading(true);
        try {
            const added: string[] = [];
            for (const f of Array.from(files)) {
                const body = new FormData();
                body.append("file", f);
                const j = await api<{ data: { url: string } }>("/api/uploads", { method: "POST", body });
                added.push(j.data.url.split("/").pop() as string);
            }
            setMedia((m) => (type === "STORY" ? added.slice(0, 1) : [...m, ...added].slice(0, 10)));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao enviar a imagem");
        } finally {
            setUploading(false);
            if (fileInput.current) fileInput.current.value = "";
        }
    };
    const moveMedia = (i: number, dir: -1 | 1) =>
        setMedia((m) => {
            const j = i + dir;
            if (j < 0 || j >= m.length) return m;
            const c = [...m];
            [c[i], c[j]] = [c[j], c[i]];
            return c;
        });

    // ---------- salvar ----------
    const iso = (v: string) => fromInputValue(v).toISOString();
    const content = { type, caption, mediaIds: media };

    const create = async (mode: "schedule" | "draft" | "now") => {
        setSaving(true);
        try {
            const payload =
                mode === "draft" ? { accountIds, ...content, draft: true }
                : mode === "now" ? { accountIds, ...content, dates: [new Date().toISOString()] }
                : { accountIds, ...content, dates: dates.map(iso) };
            const r = await api<{ message: string }>("/api/social/posts", jsonInit("POST", payload));
            toast.success(r.message);
            bump();
            closeEditor();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao salvar");
        } finally {
            setSaving(false);
        }
    };

    const save = async (toDraft = false) => {
        if (!loaded) return;
        setSaving(true);
        try {
            const payload: Record<string, unknown> = { ...content, applyToGroup };
            if (toDraft) payload.draft = true;
            else if (dates[0]) payload.publishAt = iso(dates[0]);
            await api(`/api/social/posts/${loaded.id}`, jsonInit("PATCH", payload));
            toast.success(toDraft ? "Voltou para rascunho." : dates[0] ? "Postagem salva." : "Rascunho salvo.");
            bump();
            closeEditor();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao salvar");
        } finally {
            setSaving(false);
        }
    };

    const remove = async (group: boolean) => {
        if (!loaded) return;
        const n = loaded.groupEditable;
        if (!confirm(group ? `Excluir esta e as outras ${n - 1} postagens ainda não enviadas deste grupo?` : "Excluir esta postagem?")) return;
        try {
            await api(`/api/social/posts/${loaded.id}${group ? "?group=1" : ""}`, { method: "DELETE" });
            toast.success("Excluída.");
            bump();
            closeEditor();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao excluir");
        }
    };

    const duplicate = () => {
        if (!loaded) return;
        openCreate({ accountIds: [loaded.accountId], type: loaded.type, caption: loaded.caption ?? "", mediaIds: loaded.mediaIds });
    };

    // ---------- avisos de proporção ----------
    const ratioWarning =
        ratio === null ? null
        : type === "STORY" && Math.abs(ratio - 9 / 16) > 0.08 ? "Stories ficam melhores em 9:16 (1080×1920). Esta imagem vai aparecer com barras ou cortada."
        : type === "FEED" && (ratio < 0.8 || ratio > 1.91) ? "Proporção fora de 4:5 a 1.91:1: o Instagram pode recusar esta imagem no feed."
        : null;

    const canSubmit = accountIds.length > 0 && media.length > 0 && !saving;
    const title = editing ? (readOnly ? "Detalhes da postagem" : loaded?.status === "DRAFT" ? "Editar rascunho" : "Editar postagem") : "Nova postagem";

    return (
        <Sheet open={open} onOpenChange={(o) => !o && closeEditor()}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
                <SheetHeader>
                    <SheetTitle>{title}</SheetTitle>
                    <SheetDescription>
                        {readOnly && loaded ? `${STATUS_INFO[loaded.status].label}${loaded.publishAt ? " · " + longDay(moment.tz(loaded.publishAt, TZ)) : ""}` : "Instagram e Facebook, no horário de Brasília."}
                    </SheetDescription>
                </SheetHeader>

                {loading && <p className="px-4 text-sm text-muted-foreground">Carregando…</p>}

                {!loading && (
                    <div className="space-y-5 px-4 pb-6">
                        {/* contas */}
                        <div className="space-y-2">
                            <Label>{editing ? "Conta" : "Contas"}</Label>
                            {accounts.length === 0 && <p className="text-sm text-muted-foreground">Conecte uma conta na aba Contas.</p>}
                            <div className="flex flex-wrap gap-2">
                                {accounts.map((a) => {
                                    const on = accountIds.includes(a.id);
                                    return (
                                        <button
                                            key={a.id}
                                            type="button"
                                            disabled={editing}
                                            onClick={() => setAccountIds((x) => (on ? x.filter((i) => i !== a.id) : [...x, a.id]))}
                                            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition ${on ? "border-primary bg-primary/10" : "opacity-70 hover:opacity-100"} ${editing && !on ? "hidden" : ""}`}
                                        >
                                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: accountColor(a) }} />
                                            {accountLabel(a)}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* tipo */}
                        <div className="space-y-2">
                            <Label>Tipo</Label>
                            <Select value={type} disabled={readOnly} onValueChange={(v) => { setType(v as PostType); if (v === "STORY") setMedia((m) => m.slice(0, 1)); }}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="FEED">Feed (1 a 10 imagens)</SelectItem>
                                    <SelectItem value="STORY">Story (1 imagem)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* imagens */}
                        <div className="space-y-2">
                            <Label>Imagens</Label>
                            <input ref={fileInput} type="file" multiple={type === "FEED"} accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload(e.target.files)} />
                            <div className="flex flex-wrap gap-2">
                                {media.map((id, i) => (
                                    <div key={id} className="relative">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={mediaSrc(id)} alt="" className="h-24 w-24 rounded-md border object-cover" onLoad={i === 0 ? (e) => setRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight) : undefined} />
                                        {!readOnly && (
                                            <>
                                                <button type="button" className="absolute -right-2 -top-2 rounded-full border bg-background p-0.5" onClick={() => setMedia((m) => m.filter((x) => x !== id))}><X className="h-3 w-3" /></button>
                                                {media.length > 1 && (
                                                    <div className="absolute inset-x-0 bottom-0 flex justify-between px-0.5 pb-0.5">
                                                        <button type="button" disabled={i === 0} onClick={() => moveMedia(i, -1)} className="rounded bg-background/80 p-0.5 disabled:opacity-30"><ArrowLeft className="h-3 w-3" /></button>
                                                        <button type="button" disabled={i === media.length - 1} onClick={() => moveMedia(i, 1)} className="rounded bg-background/80 p-0.5 disabled:opacity-30"><ArrowRight className="h-3 w-3" /></button>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                ))}
                                {!readOnly && (type === "FEED" ? media.length < 10 : media.length < 1) && (
                                    <Button type="button" variant="outline" size="sm" className="h-24 w-24 flex-col" disabled={uploading} onClick={() => fileInput.current?.click()}>
                                        <ImagePlus className="h-5 w-5" />{uploading ? "Enviando…" : "Adicionar"}
                                    </Button>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">JPG, PNG ou WebP, até 5 MB cada. Vídeo e Reels ainda não.</p>
                            {ratioWarning && <p className="text-xs text-amber-600 dark:text-amber-400">{ratioWarning}</p>}
                        </div>

                        {/* legenda */}
                        {type === "FEED" && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label>Legenda</Label>
                                    <span className={`text-xs tabular-nums ${caption.length > limit ? "text-destructive" : "text-muted-foreground"}`}>{caption.length}/{limit}</span>
                                </div>
                                <Textarea rows={5} value={caption} disabled={readOnly} onChange={(e) => setCaption(e.target.value)} />
                                {!readOnly && signatures.length > 0 && (
                                    <Select value="" onValueChange={(id) => { const s = signatures.find((x) => x.id === id); if (s) setCaption((c) => (c ? c.trimEnd() + "\n\n" : "") + s.content); }}>
                                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Inserir texto salvo (endereço, horário…)" /></SelectTrigger>
                                        <SelectContent>{signatures.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                )}
                            </div>
                        )}

                        {/* datas */}
                        {!readOnly && (
                            <div className="space-y-2">
                                <Label>{editing ? "Publicar em" : "Datas de publicação"}</Label>
                                {dates.length === 0 && editing && <p className="text-xs text-muted-foreground">Rascunho sem data. Escolha uma data para agendar.</p>}
                                {dates.map((d, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <input type="datetime-local" value={d} onChange={(e) => setDate(i, e.target.value)} className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm" />
                                        {!editing && dates.length > 1 && <Button type="button" size="icon" variant="ghost" onClick={() => setDates((x) => x.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>}
                                    </div>
                                ))}
                                {editing && dates.length === 0 && <Button type="button" size="sm" variant="outline" onClick={() => setDates([nextHourValue()])}><CalendarPlus className="h-4 w-4 mr-2" />Definir data</Button>}
                                {!editing && (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button type="button" size="sm" variant="outline" onClick={addDate}><CalendarPlus className="h-4 w-4 mr-2" />Adicionar data</Button>
                                        <Button type="button" size="sm" variant="outline" onClick={addWeekly} disabled={!dates.length}>+ 1 semana</Button>
                                        <Select value="" onValueChange={(v) => addWeekday(Number(v))}>
                                            <SelectTrigger className="h-8 w-auto gap-2 text-xs"><SelectValue placeholder="Próxima…" /></SelectTrigger>
                                            <SelectContent>{DAYS_SHORT.map((n, i) => <SelectItem key={n} value={String(i)}>{["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][i]}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                )}
                                {suggested.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                        Horários sugeridos:
                                        {suggested.map((t) => <button key={t} type="button" onClick={() => applyTime(t)} className="rounded-full border px-2 py-0.5 hover:bg-accent">{t}</button>)}
                                    </div>
                                )}
                                {!editing && dates.length * accountIds.length > 1 && (
                                    <p className="text-xs text-muted-foreground">Vai criar {dates.length * accountIds.length} postagens ({accountIds.length} conta(s) × {dates.length} data(s)).</p>
                                )}
                            </div>
                        )}

                        {/* pré-visualização */}
                        {media.length > 0 && (
                            <div className="space-y-2">
                                <Label>Pré-visualização</Label>
                                <div className="mx-auto w-48 overflow-hidden rounded-lg border bg-black">
                                    <div className={type === "STORY" ? "aspect-[9/16]" : "aspect-square"}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={mediaSrc(media[0])} alt="" className="h-full w-full object-cover" />
                                    </div>
                                </div>
                                {type === "FEED" && caption && <p className="mx-auto line-clamp-3 max-w-xs whitespace-pre-line text-center text-xs text-muted-foreground">{caption}</p>}
                            </div>
                        )}

                        {/* postagem já enviada */}
                        {readOnly && loaded && (
                            <div className="space-y-2 rounded-lg border p-3 text-sm">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant={STATUS_INFO[loaded.status].variant}>{STATUS_INFO[loaded.status].label}</Badge>
                                    {loaded.account && <span className="text-muted-foreground">{accountLabel(loaded.account)}</span>}
                                </div>
                                {loaded.error && <p className="text-destructive">{loaded.error}</p>}
                                {loaded.status === "FAILED" && <p className="text-xs text-muted-foreground">Antes de publicar de novo, confira o perfil: se o erro foi "não consegui confirmar", a postagem pode ter saído.</p>}
                                {loaded.releaseUrl && <Button asChild size="sm" variant="outline"><a href={loaded.releaseUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-2" />Abrir na rede</a></Button>}
                            </div>
                        )}

                        {/* ações */}
                        <div className="space-y-2 border-t pt-4">
                            {!editing && (
                                <>
                                    <Button className="w-full" disabled={!canSubmit || dates.length === 0} onClick={() => create("schedule")}>{saving ? "Salvando…" : dates.length * accountIds.length > 1 ? `Agendar ${dates.length * accountIds.length} postagens` : "Agendar"}</Button>
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button variant="outline" disabled={!canSubmit} onClick={() => create("draft")}>Salvar rascunho</Button>
                                        <Button variant="outline" disabled={!canSubmit} onClick={() => confirm("Publicar agora? Sai em até 1 minuto.") && create("now")}>Publicar agora</Button>
                                    </div>
                                </>
                            )}

                            {editing && loaded && !readOnly && (
                                <>
                                    {loaded.groupEditable > 1 && (
                                        <label className="flex items-center gap-2 text-sm">
                                            <input type="checkbox" checked={applyToGroup} onChange={(e) => setApplyToGroup(e.target.checked)} />
                                            Aplicar imagens e legenda às outras {loaded.groupEditable - 1} do grupo
                                        </label>
                                    )}
                                    <Button className="w-full" disabled={!canSubmit} onClick={() => save(false)}>
                                        {saving ? "Salvando…" : loaded.status === "DRAFT" && dates[0] ? "Agendar" : "Salvar alterações"}
                                    </Button>
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button variant="outline" onClick={duplicate}><Copy className="h-4 w-4 mr-2" />Duplicar</Button>
                                        {loaded.status === "PENDING" && <Button variant="outline" disabled={saving} onClick={() => save(true)}>Voltar a rascunho</Button>}
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        <Button variant="ghost" className="text-destructive" onClick={() => remove(false)}><Trash2 className="h-4 w-4 mr-2" />Excluir</Button>
                                        {loaded.groupEditable > 1 && <Button variant="ghost" className="text-destructive" onClick={() => remove(true)}>Excluir as {loaded.groupEditable} do grupo</Button>}
                                    </div>
                                </>
                            )}

                            {readOnly && loaded && (
                                <div className="grid grid-cols-2 gap-2">
                                    <Button onClick={duplicate}><Copy className="h-4 w-4 mr-2" />Duplicar / reagendar</Button>
                                    <Button variant="ghost" className="text-destructive" onClick={() => remove(false)}><Trash2 className="h-4 w-4 mr-2" />Remover do histórico</Button>
                                </div>
                            )}
                        </div>
                        {selected.length === 1 && <p className="text-center text-xs text-muted-foreground">Conta: {accountName(selected[0])}</p>}
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}
