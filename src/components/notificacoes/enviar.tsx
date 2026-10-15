"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Bell, Send, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

// Só é montado para SUPERADMIN (a página decide no servidor); o POST em /api/notifications também confere o papel.
export function EnviarNotificacao() {
    const [title, setTitle] = useState("");
    const [message, setMessage] = useState("");
    const [type, setType] = useState("INFO");
    const [broadcast, setBroadcast] = useState(true);
    const [targetUserId, setTargetUserId] = useState("");
    const [href, setHref] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSend = async () => {
        if (!title || !message) return toast.error("Título e mensagem são obrigatórios");
        if (!broadcast && !targetUserId) return toast.error("O ID do usuário de destino é obrigatório quando não for envio geral");

        setLoading(true);
        try {
            const res = await fetch("/api/notifications", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title,
                    message,
                    type,
                    broadcast,
                    targetUserId: broadcast ? undefined : targetUserId,
                    href
                })
            });

            if (res.ok) {
                const responseData = await res.json();
                const data = responseData?.data || {};
                toast.success(`Notificação enviada com sucesso! (Total: ${data.count || 1})`);
                setTitle("");
                setMessage("");
                setHref("");
            } else {
                toast.error("Falha ao enviar a notificação");
            }
        } catch (e) {
            toast.error("Erro ao enviar a notificação");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2">
            <Card>
                <CardHeader>
                    <CardTitle>Nova notificação</CardTitle>
                    <CardDescription>Envie avisos a usuários ou comunicados para todo o sistema.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Título</Label>
                        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="ex.: Manutenção do sistema" />
                    </div>

                    <div className="space-y-2">
                        <Label>Mensagem</Label>
                        <Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Mensagem detalhada..." />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div className="space-y-2">
                            <Label>Tipo</Label>
                            <Select value={type} onValueChange={setType}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="INFO">Informação</SelectItem>
                                    <SelectItem value="WARNING">Aviso</SelectItem>
                                    <SelectItem value="SUCCESS">Sucesso</SelectItem>
                                    <SelectItem value="SYSTEM">Sistema</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Link de ação (opcional)</Label>
                            <Input value={href} onChange={e => setHref(e.target.value)} placeholder="/dashboard/settings" />
                        </div>
                    </div>

                    <div className="flex items-center space-x-2 py-2">
                        <Switch id="broadcast" checked={broadcast} onCheckedChange={setBroadcast} />
                        <Label htmlFor="broadcast">Enviar para TODOS os usuários</Label>
                    </div>

                    {!broadcast && (
                        <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                            <Label>ID do usuário de destino</Label>
                            <Input value={targetUserId} onChange={e => setTargetUserId(e.target.value)} placeholder="ID do usuário (cuid)" />
                        </div>
                    )}

                    <div className="pt-4">
                        <Button className="w-full" onClick={handleSend} disabled={loading}>
                            {loading ? <CheckCircle2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                            Enviar notificação
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <div className="space-y-6">
                <Card className="bg-zinc-50 border-dashed">
                    <CardHeader>
                        <CardTitle className="text-base text-muted-foreground">Pré-visualização</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="bg-white p-4 rounded-lg shadow-sm border flex gap-3 items-start">
                            <div className={`p-2 rounded-full ${type === 'WARNING' ? 'bg-yellow-100 text-yellow-600' : type === 'SUCCESS' ? 'bg-green-100 text-green-600' : 'bg-zinc-100 text-zinc-600'}`}>
                                <Bell className="h-5 w-5" />
                            </div>
                            <div>
                                <h4 className="font-semibold text-sm">{title || "Título da notificação"}</h4>
                                <p className="text-xs text-muted-foreground mt-1">{message || "O conteúdo da notificação aparecerá aqui."}</p>
                                <p className="text-[10px] text-zinc-400 mt-2">Agora mesmo</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
