"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import moment from "moment-timezone";
import { Copy, Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSocial } from "@/components/social/social-context";
import { Post, STATUS_INFO, TZ, accountColor, accountLabel, api, mediaSrc, postTypeLabel } from "@/components/social/types";

const PERIODS = [
    { id: "7", label: "Últimos 7 dias" },
    { id: "30", label: "Últimos 30 dias" },
    { id: "90", label: "Últimos 90 dias" },
    { id: "all", label: "Tudo" },
];

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

export default function HistoricoPage() {
    const { filter, openEdit, openCreate, version } = useSocial();
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState("30");
    const [status, setStatus] = useState("all");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const q = new URLSearchParams({ status: status === "all" ? "PUBLISHED,FAILED" : status, limit: "1000" });
            if (filter !== "all") q.set("accountId", filter);
            if (period !== "all") q.set("from", moment.tz(TZ).subtract(Number(period), "day").startOf("day").toISOString());
            q.set("to", moment.tz(TZ).add(1, "day").toISOString());
            setPosts((await api<{ data: Post[] }>(`/api/social/posts?${q}`)).data);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao carregar o histórico");
        } finally {
            setLoading(false);
        }
    }, [filter, period, status]);

    useEffect(() => { load(); }, [load, version]);

    const totals = useMemo(() => ({ ok: posts.filter((p) => p.status === "PUBLISHED").length, fail: posts.filter((p) => p.status === "FAILED").length }), [posts]);

    const exportCsv = () => {
        const head = ["Data", "Conta", "Tipo", "Status", "Link", "Erro", "Legenda"];
        const rows = posts.map((p) => [
            p.publishAt ? moment.tz(p.publishAt, TZ).format("DD/MM/YYYY HH:mm") : "",
            p.account ? accountLabel(p.account) : "",
            postTypeLabel(p), STATUS_INFO[p.status].label, p.releaseUrl ?? "", p.error ?? "", p.caption ?? "",
        ].map((c) => csvCell(String(c))).join(";"));
        const blob = new Blob(["﻿" + [head.join(";"), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `historico-redes-sociais-${moment.tz(TZ).format("YYYY-MM-DD")}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <Select value={period} onValueChange={setPeriod}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>{PERIODS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        <SelectItem value="PUBLISHED">Publicadas</SelectItem>
                        <SelectItem value="FAILED">Com falha</SelectItem>
                    </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">{totals.ok} publicada(s){totals.fail > 0 && <> · <span className="text-destructive">{totals.fail} com falha</span></>}</span>
                <Button variant="outline" size="sm" className="ml-auto" onClick={exportCsv} disabled={!posts.length}><Download className="mr-2 h-4 w-4" />Exportar CSV</Button>
            </div>

            {!loading && posts.length === 0 && <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nada no período.</p>}

            <div className="space-y-2">
                {posts.map((p) => (
                    <div key={p.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
                        <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => openEdit(p)}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={mediaSrc(p.mediaIds[0])} alt="" className="h-14 w-14 shrink-0 rounded-md border object-cover" />
                            <div className="min-w-0 space-y-0.5 text-sm">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant={STATUS_INFO[p.status].variant}>{STATUS_INFO[p.status].label}</Badge>
                                    <span className="font-medium">{postTypeLabel(p)}</span>
                                    <span className="flex items-center gap-1 text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ background: accountColor(p.account) }} />{p.account ? accountLabel(p.account) : "conta removida"}</span>
                                </div>
                                <p className="text-muted-foreground">{p.publishAt ? moment.tz(p.publishAt, TZ).format("DD/MM/YYYY [às] HH:mm") : "—"}</p>
                                {p.caption && <p className="truncate">{p.caption}</p>}
                                {p.error && <p className="text-destructive">{p.error}</p>}
                            </div>
                        </button>
                        <div className="flex shrink-0 gap-2">
                            {p.releaseUrl && <Button asChild size="sm" variant="outline"><a href={p.releaseUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Abrir</a></Button>}
                            <Button size="sm" variant="outline" onClick={() => openCreate({ accountIds: [p.accountId], type: p.type, caption: p.caption ?? "", mediaIds: p.mediaIds })}><Copy className="mr-2 h-4 w-4" />Reagendar</Button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
