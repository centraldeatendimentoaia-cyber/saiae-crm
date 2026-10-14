"use client";

import { useState } from "react";
import { CheckCircle2, Link2, Plus, ShieldAlert, Trash2, Unlink, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSocial } from "@/components/social/social-context";
import { Account, accountColor, api, jsonInit, providerLabel } from "@/components/social/types";

type TokenState = { ok: boolean; needsReconnect: boolean; message?: string } | "checking";

function AccountCard({ a }: { a: Account }) {
    const { reloadAccounts, bump } = useSocial();
    const [nickname, setNickname] = useState(a.nickname ?? "");
    const [color, setColor] = useState(accountColor(a));
    const [times, setTimes] = useState<string[]>(a.postingTimes);
    const [newTime, setNewTime] = useState("");
    const [token, setToken] = useState<TokenState | null>(null);

    const patch = async (body: Record<string, unknown>, okMsg = "Salvo.") => {
        try {
            await api(`/api/social/accounts/${a.id}`, jsonInit("PATCH", body));
            toast.success(okMsg);
            reloadAccounts();
            bump();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao salvar");
        }
    };

    const check = async () => {
        setToken("checking");
        try {
            setToken((await api<{ data: Exclude<TokenState, "checking"> }>(`/api/social/accounts/${a.id}/status`)).data);
        } catch (e) {
            setToken(null);
            toast.error(e instanceof Error ? e.message : "Falha ao verificar");
        }
    };

    const addTime = () => {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(newTime) || times.includes(newTime)) return;
        const next = [...times, newTime].sort();
        setTimes(next);
        setNewTime("");
        patch({ postingTimes: next });
    };
    const dropTime = (t: string) => {
        const next = times.filter((x) => x !== t);
        setTimes(next);
        patch({ postingTimes: next });
    };

    const disconnect = async () => {
        if (!confirm("Desconectar esta conta? As postagens pendentes e os rascunhos dela serão cancelados.")) return;
        try {
            await api(`/api/social/accounts/${a.id}`, { method: "DELETE" });
            await reloadAccounts();
            bump();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao desconectar");
        }
    };

    return (
        <Card>
            <CardContent className="space-y-4 p-4">
                <div className="flex items-center gap-3">
                    {a.picture
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={a.picture} alt="" className="h-10 w-10 rounded-full border object-cover" />
                        : <span className="h-10 w-10 rounded-full" style={{ background: accountColor(a) }} />}
                    <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{a.name}</p>
                        <p className="text-sm text-muted-foreground">{providerLabel(a.provider)}{a.username ? ` · @${a.username}` : ""}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={disconnect} title="Desconectar"><Unlink className="h-4 w-4" /></Button>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Button size="sm" variant="outline" onClick={check} disabled={token === "checking"}>{token === "checking" ? "Verificando…" : "Verificar conexão"}</Button>
                    {token && token !== "checking" && (token.ok
                        ? <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="h-4 w-4" />Conexão ok</span>
                        : <span className="flex items-center gap-1 text-destructive"><ShieldAlert className="h-4 w-4" />{token.needsReconnect ? "Reconecte: cole um token novo abaixo. " : ""}{token.message}</span>)}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <Label>Apelido</Label>
                        <div className="flex gap-2">
                            <Input value={nickname} maxLength={60} onChange={(e) => setNickname(e.target.value)} placeholder={a.username ? `@${a.username}` : a.name} />
                            <Button variant="outline" onClick={() => patch({ nickname })}>Salvar</Button>
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Cor no calendário</Label>
                        <div className="flex items-center gap-2">
                            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-14 cursor-pointer rounded-md border bg-transparent p-1" />
                            <Button variant="outline" onClick={() => patch({ color })}>Salvar</Button>
                        </div>
                    </div>
                </div>

                <div className="space-y-1.5">
                    <Label>Horários sugeridos</Label>
                    <div className="flex flex-wrap items-center gap-2">
                        {times.map((t) => (
                            <span key={t} className="flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm tabular-nums">
                                {t}<button type="button" onClick={() => dropTime(t)} aria-label={`Remover ${t}`}><X className="h-3 w-3" /></button>
                            </span>
                        ))}
                        <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" />
                        <Button size="sm" variant="outline" onClick={addTime} disabled={!newTime}><Plus className="mr-1 h-4 w-4" />Adicionar</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Aparecem como atalhos ao agendar. Até 8 horários.</p>
                </div>
            </CardContent>
        </Card>
    );
}

function Connect() {
    const { accounts, reloadAccounts, bump } = useSocial();
    const [token, setToken] = useState("");
    const [busy, setBusy] = useState(false);

    const connect = async () => {
        setBusy(true);
        try {
            const r = await api<{ message: string; warning?: string[] }>("/api/social/accounts", jsonInit("POST", { userToken: token }));
            setToken("");
            await reloadAccounts();
            bump();
            if (r.warning?.length) toast.warning(r.message, { duration: 12000 });
            else toast.success(r.message);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao conectar");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card>
            <CardHeader><CardTitle className="text-base">{accounts.length ? "Adicionar ou atualizar contas" : "Conectar contas"}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
                <Label>Token de acesso da Meta</Label>
                <Textarea rows={2} value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAB…" />
                <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Como gerar o token</summary>
                    <ol className="mt-2 list-decimal space-y-1 pl-5">
                        <li>No Graph API Explorer, escolha o seu app e adicione: pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish.</li>
                        <li>Em <b>Gerar token</b>, marque as Páginas <b>e também as contas do Instagram</b> na janela da Meta.</li>
                        <li>No Access Token Debugger, clique em <b>Extend Access Token</b> e cole aqui o token estendido.</li>
                        <li>O Instagram precisa ser <b>Business ou Creator</b> e estar ligado à Página.</li>
                    </ol>
                </details>
                <Button onClick={connect} disabled={busy || token.trim().length < 20}><Link2 className="mr-2 h-4 w-4" />{busy ? "Conectando…" : "Conectar"}</Button>
            </CardContent>
        </Card>
    );
}

function Signatures() {
    const { signatures, reloadSignatures } = useSocial();
    const [name, setName] = useState("");
    const [content, setContent] = useState("");

    const add = async () => {
        try {
            await api("/api/social/signatures", jsonInit("POST", { name, content }));
            setName("");
            setContent("");
            reloadSignatures();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao salvar");
        }
    };
    const drop = async (id: string) => {
        try {
            await api(`/api/social/signatures/${id}`, { method: "DELETE" });
            reloadSignatures();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao excluir");
        }
    };

    return (
        <Card>
            <CardHeader><CardTitle className="text-base">Textos salvos</CardTitle></CardHeader>
            <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">Endereço, horário de funcionamento, chamada para agendar… Insira em qualquer legenda com um clique.</p>
                {signatures.map((s) => (
                    <div key={s.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                        <div className="min-w-0 flex-1"><p className="font-medium">{s.name}</p><p className="line-clamp-2 whitespace-pre-line text-muted-foreground">{s.content}</p></div>
                        <Button size="sm" variant="ghost" onClick={() => drop(s.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                ))}
                <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex.: Endereço e horário)" />
                <Textarea rows={3} value={content} maxLength={2000} onChange={(e) => setContent(e.target.value)} placeholder="Texto que será colado na legenda" />
                <Button variant="outline" onClick={add} disabled={!name.trim() || !content.trim()}><Plus className="mr-2 h-4 w-4" />Salvar texto</Button>
            </CardContent>
        </Card>
    );
}

export default function ContasPage() {
    const { accounts, accountsLoaded } = useSocial();
    return (
        <div className="space-y-5">
            {accountsLoaded && accounts.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma conta conectada ainda.</p>}
            <div className="grid gap-4 lg:grid-cols-2">{accounts.map((a) => <AccountCard key={a.id} a={a} />)}</div>
            <div className="grid gap-4 lg:grid-cols-2"><Connect /><Signatures /></div>
        </div>
    );
}
