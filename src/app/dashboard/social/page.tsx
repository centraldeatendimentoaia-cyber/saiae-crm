"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Share2, Plus, RefreshCw, Trash2, ImagePlus, X, ExternalLink, Link2, Unlink } from "lucide-react";
import { toast } from "sonner";
import moment from "moment-timezone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Account { id: string; provider: "instagram" | "facebook"; name: string; username: string | null; picture: string | null }
interface Post {
    id: string; type: "FEED" | "STORY"; caption: string | null; mediaIds: string[]; publishAt: string;
    status: "PENDING" | "PUBLISHING" | "PUBLISHED" | "FAILED"; releaseUrl: string | null; error: string | null;
    account: { provider: string; name: string; username: string | null } | null;
}

const TZ = "America/Sao_Paulo";
const STATUS: Record<Post["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    PENDING: { label: "Agendada", variant: "secondary" },
    PUBLISHING: { label: "Publicando…", variant: "outline" },
    PUBLISHED: { label: "Publicada", variant: "default" },
    FAILED: { label: "Falhou", variant: "destructive" },
};
const nextHour = () => moment().tz(TZ).add(1, "hour").startOf("hour").format("YYYY-MM-DDTHH:mm");

async function api(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.status === false) throw new Error(json.message || "Algo deu errado");
    return json;
}

export default function SocialPage() {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [posts, setPosts] = useState<Post[]>([]);
    const [tab, setTab] = useState<"pending" | "history">("pending");
    const [loading, setLoading] = useState(false);

    // conectar
    const [token, setToken] = useState("");
    const [connecting, setConnecting] = useState(false);

    // nova postagem
    const [accountId, setAccountId] = useState("");
    const [type, setType] = useState<"FEED" | "STORY">("FEED");
    const [caption, setCaption] = useState("");
    const [media, setMedia] = useState<{ id: string; url: string }[]>([]);
    const [when, setWhen] = useState(nextHour());
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    const loadAccounts = useCallback(async () => {
        try {
            const j = await api("/api/social/accounts");
            setAccounts(j.data);
            setAccountId((cur) => cur || j.data[0]?.id || "");
        } catch (e: any) { toast.error(e.message); }
    }, []);

    const loadPosts = useCallback(async (t: "pending" | "history") => {
        setLoading(true);
        try { setPosts((await api(`/api/social/posts?tab=${t}`)).data); }
        catch (e: any) { toast.error(e.message); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { loadAccounts(); }, [loadAccounts]);
    useEffect(() => { loadPosts(tab); }, [tab, loadPosts]);

    const connect = async () => {
        setConnecting(true);
        try {
            const j = await api("/api/social/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userToken: token }) });
            setAccounts(j.data); setAccountId((cur) => cur || j.data[0]?.id || ""); setToken("");
            toast.success(j.message);
        } catch (e: any) { toast.error(e.message); }
        finally { setConnecting(false); }
    };

    const disconnect = async (id: string) => {
        if (!confirm("Desconectar esta conta? Postagens pendentes dela serão canceladas.")) return;
        try { await api(`/api/social/accounts/${id}`, { method: "DELETE" }); setAccountId(""); await loadAccounts(); await loadPosts(tab); }
        catch (e: any) { toast.error(e.message); }
    };

    const upload = async (files: FileList | null) => {
        if (!files?.length) return;
        setUploading(true);
        try {
            const added: { id: string; url: string }[] = [];
            for (const f of Array.from(files)) {
                const body = new FormData(); body.append("file", f);
                const j = await api("/api/uploads", { method: "POST", body });
                added.push({ id: j.data.url.split("/").pop(), url: j.data.url });
            }
            setMedia((m) => (type === "STORY" ? added.slice(0, 1) : [...m, ...added].slice(0, 10)));
        } catch (e: any) { toast.error(e.message); }
        finally { setUploading(false); if (fileInput.current) fileInput.current.value = ""; }
    };

    const schedule = async () => {
        setSaving(true);
        try {
            const publishAt = moment.tz(when, TZ).toISOString();
            await api("/api/social/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, type, caption, mediaIds: media.map((m) => m.id), publishAt }) });
            toast.success("Postagem agendada.");
            setCaption(""); setMedia([]); setWhen(nextHour());
            if (tab !== "pending") setTab("pending"); else loadPosts("pending");
        } catch (e: any) { toast.error(e.message); }
        finally { setSaving(false); }
    };

    const remove = async (id: string) => {
        try { await api(`/api/social/posts/${id}`, { method: "DELETE" }); loadPosts(tab); }
        catch (e: any) { toast.error(e.message); }
    };

    const account = accounts.find((a) => a.id === accountId);
    const label = (a: { provider: string; name: string; username: string | null }) =>
        `${a.provider === "instagram" ? "Instagram" : "Facebook"} · ${a.username ? "@" + a.username : a.name}`;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2"><Share2 className="h-5 w-5 sm:h-6 sm:w-6" /> Postagens e Stories</h1>
                <p className="text-sm text-muted-foreground">Agende fotos, carrosséis e Stories no Instagram e na Página do Facebook.</p>
            </div>

            <Card>
                <CardHeader><CardTitle className="text-base">Contas conectadas</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                    {accounts.map((a) => (
                        <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
                            <span>{label(a)} <span className="text-muted-foreground">({a.name})</span></span>
                            <Button size="sm" variant="ghost" onClick={() => disconnect(a.id)}><Unlink className="h-4 w-4" /></Button>
                        </div>
                    ))}
                    <div className="space-y-2">
                        <Label>Token de acesso da Meta {accounts.length > 0 && "(cole outro para adicionar ou atualizar contas)"}</Label>
                        <Textarea rows={2} value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAB…" />
                        <p className="text-xs text-muted-foreground">Gere no Graph API Explorer com as permissões pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic e instagram_content_publish. O token da Página é guardado criptografado.</p>
                        <Button size="sm" onClick={connect} disabled={connecting || token.trim().length < 20}><Link2 className="h-4 w-4 mr-2" />{connecting ? "Conectando…" : "Conectar"}</Button>
                    </div>
                </CardContent>
            </Card>

            {accounts.length > 0 && (
                <Card>
                    <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> Nova postagem</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-3">
                            <div className="space-y-2">
                                <Label>Conta</Label>
                                <Select value={accountId} onValueChange={setAccountId}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{label(a)}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Tipo</Label>
                                <Select value={type} onValueChange={(v) => { setType(v as "FEED" | "STORY"); if (v === "STORY") setMedia((m) => m.slice(0, 1)); }}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="FEED">Feed (1 a 10 imagens)</SelectItem>
                                        <SelectItem value="STORY">Story (1 imagem)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Publicar em (Brasília)</Label>
                                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Imagens</Label>
                            <input ref={fileInput} type="file" multiple={type === "FEED"} accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload(e.target.files)} />
                            <div className="flex flex-wrap gap-2">
                                {media.map((m) => (
                                    <div key={m.id} className="relative">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={m.url} alt="" className="h-24 w-24 rounded-md border border-border object-cover" />
                                        <button type="button" className="absolute -top-2 -right-2 rounded-full bg-background border p-0.5" onClick={() => setMedia((x) => x.filter((y) => y.id !== m.id))}><X className="h-3 w-3" /></button>
                                    </div>
                                ))}
                                {(type === "FEED" ? media.length < 10 : media.length < 1) && (
                                    <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}><ImagePlus className="h-4 w-4 mr-2" />{uploading ? "Enviando…" : "Adicionar"}</Button>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">JPG, PNG ou WebP, até 5 MB cada. Stories ficam melhores em 9:16 (1080×1920).</p>
                        </div>

                        {type === "FEED" && (
                            <div className="space-y-2">
                                <Label>Legenda</Label>
                                <Textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={account?.provider === "instagram" ? 2200 : 5000} />
                            </div>
                        )}
                        <Button onClick={schedule} disabled={saving || !accountId || media.length === 0}>{saving ? "Agendando…" : "Agendar"}</Button>
                    </CardContent>
                </Card>
            )}

            <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <Tabs value={tab} onValueChange={(v) => setTab(v as "pending" | "history")}>
                        <TabsList><TabsTrigger value="pending">Agendadas</TabsTrigger><TabsTrigger value="history">Histórico</TabsTrigger></TabsList>
                    </Tabs>
                    <Button variant="outline" size="sm" onClick={() => loadPosts(tab)} disabled={loading}><RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
                </div>
                {posts.length === 0 && <p className="text-sm text-muted-foreground">Nada por aqui.</p>}
                {posts.map((p) => (
                    <Card key={p.id}>
                        <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-start gap-3 min-w-0">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={`/api/uploads/${p.mediaIds[0]}`} alt="" className="h-16 w-16 rounded-md border border-border object-cover shrink-0" />
                                <div className="min-w-0 text-sm">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
                                        <span className="font-medium">{p.type === "STORY" ? "Story" : `Feed${p.mediaIds.length > 1 ? ` · ${p.mediaIds.length} imagens` : ""}`}</span>
                                        <span className="text-muted-foreground">{p.account ? label(p.account) : "conta removida"}</span>
                                    </div>
                                    <p className="text-muted-foreground">{moment(p.publishAt).tz(TZ).format("DD/MM/YYYY HH:mm")}</p>
                                    {p.caption && <p className="truncate max-w-md">{p.caption}</p>}
                                    {p.error && <p className="text-destructive">{p.error}</p>}
                                </div>
                            </div>
                            <div className="flex gap-2 shrink-0">
                                {p.releaseUrl && <Button asChild size="sm" variant="outline"><a href={p.releaseUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-2" />Abrir</a></Button>}
                                {p.status !== "PUBLISHING" && <Button size="sm" variant="ghost" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4" /></Button>}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
