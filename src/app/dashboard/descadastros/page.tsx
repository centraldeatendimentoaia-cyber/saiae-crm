"use client";

import { useCallback, useEffect, useState } from "react";
import { UserX, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";

interface Row {
    id: string;
    jid: string;
    phone: string;
    name: string | null;
    createdAt: string;
}

export default function DescadastrosPage() {
    const { sessionId } = useSession();
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(false);
    const [phones, setPhones] = useState("");
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        if (!sessionId) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/optouts/${sessionId}`);
            const data = await res.json();
            if (res.ok && data.status) setRows(data.data);
        } finally {
            setLoading(false);
        }
    }, [sessionId]);

    useEffect(() => { load(); }, [load]);

    const add = async () => {
        const list = phones.split(/[\n,;]+/).map(p => p.trim()).filter(Boolean);
        if (list.length === 0) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/optouts/${sessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phones: list }),
            });
            const data = await res.json();
            if (!res.ok || !data.status) throw new Error(data.message || "Falha ao adicionar");
            toast.success(`${data.data.added} ${data.data.added === 1 ? "número adicionado" : "números adicionados"} à lista.`);
            setPhones("");
            load();
        } catch (e: any) {
            toast.error(e.message || "Falha ao adicionar");
        } finally {
            setSaving(false);
        }
    };

    const remove = async (body: { id: string } | { all: true }, confirmText?: string) => {
        if (confirmText && !window.confirm(confirmText)) return;
        const res = await fetch(`/api/optouts/${sessionId}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (res.ok) {
            toast.success("Lista atualizada.");
            load();
        } else {
            toast.error("Não foi possível atualizar a lista.");
        }
    };

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div>
                    <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Descadastrados</h2>
                    <p className="text-muted-foreground">
                        Quem respondeu SAIR (ou PARAR) não recebe mais disparos nem mensagens agendadas deste número. Se a pessoa responder VOLTAR, ela volta sozinha para o envio.
                    </p>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" />Adicionar números</CardTitle>
                        <CardDescription>Use quando alguém pedir para sair por outro canal (ligação, balcão, outro WhatsApp).</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <Label htmlFor="optout-phones">Um número por linha</Label>
                        <Textarea id="optout-phones" value={phones} onChange={e => setPhones(e.target.value)} placeholder={"(61) 99999-9999\n+55 11 98888-7777"} className="min-h-[90px]" />
                        <Button onClick={add} disabled={saving || !phones.trim()}>{saving ? "Adicionando..." : "Adicionar à lista"}</Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex-row items-center justify-between space-y-0">
                        <div>
                            <CardTitle className="flex items-center gap-2"><UserX className="h-5 w-5" />Na lista ({rows.length})</CardTitle>
                            <CardDescription>Remover um número o devolve aos próximos disparos.</CardDescription>
                        </div>
                        {rows.length > 0 && (
                            <Button variant="outline" size="sm" onClick={() => remove({ all: true }, `Remover todos os ${rows.length} números da lista? Eles voltarão a receber disparos.`)}>
                                Limpar lista
                            </Button>
                        )}
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <p className="text-sm text-muted-foreground">Carregando...</p>
                        ) : rows.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Ninguém descadastrado por enquanto.</p>
                        ) : (
                            <ul className="divide-y divide-border">
                                {rows.map(r => (
                                    <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                                        <div className="min-w-0">
                                            <p className="truncate font-medium">{r.name || r.phone}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {r.name ? `${r.phone} · ` : ""}desde {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                                            </p>
                                        </div>
                                        <Button variant="ghost" size="sm" onClick={() => remove({ id: r.id })} aria-label="Remover da lista">
                                            <Trash2 className="h-4 w-4" /> Remover
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            </div>
        </SessionGuard>
    );
}
