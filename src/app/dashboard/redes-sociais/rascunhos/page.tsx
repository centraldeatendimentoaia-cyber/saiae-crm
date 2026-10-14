"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useSocial } from "@/components/social/social-context";
import { Post, accountColor, accountLabel, api, mediaSrc, postTypeLabel } from "@/components/social/types";

export default function RascunhosPage() {
    const { filter, openEdit, version, bump } = useSocial();
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const q = new URLSearchParams({ status: "DRAFT" });
            if (filter !== "all") q.set("accountId", filter);
            setPosts((await api<{ data: Post[] }>(`/api/social/posts?${q}`)).data);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao carregar os rascunhos");
        } finally {
            setLoading(false);
        }
    }, [filter]);

    useEffect(() => { load(); }, [load, version]);

    const remove = async (p: Post) => {
        if (!confirm("Excluir este rascunho?")) return;
        try {
            await api(`/api/social/posts/${p.id}`, { method: "DELETE" });
            bump();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao excluir");
        }
    };

    if (!loading && posts.length === 0) {
        return (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                <FileText className="mx-auto mb-2 h-6 w-6" />
                Nenhum rascunho. Em <b>Nova postagem</b>, use <b>Salvar rascunho</b> para deixar o conteúdo pronto e escolher a data depois.
            </div>
        );
    }

    return (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((p) => (
                <Card key={p.id} className="overflow-hidden">
                    <div className="relative aspect-video bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={mediaSrc(p.mediaIds[0])} alt="" className="h-full w-full object-cover" />
                        <span className="absolute left-2 top-2 rounded bg-background/90 px-1.5 py-0.5 text-xs">{postTypeLabel(p)}</span>
                    </div>
                    <CardContent className="space-y-2 p-3">
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="h-2 w-2 rounded-full" style={{ background: accountColor(p.account) }} />
                            {p.account ? accountLabel(p.account) : "conta removida"}
                        </p>
                        <p className="line-clamp-3 min-h-[3.5rem] whitespace-pre-line text-sm">{p.caption || <span className="text-muted-foreground">Sem legenda</span>}</p>
                        <div className="flex gap-2">
                            <Button size="sm" className="flex-1" onClick={() => openEdit(p)}>Editar e agendar</Button>
                            <Button size="sm" variant="ghost" onClick={() => remove(p)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
