"use client";

import moment from "moment-timezone";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, CheckCircle2, XCircle } from "lucide-react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ScheduledMessage {
    id: string;
    jid: string;
    content: string | null;
    sendAt: string;
    status: string;
    mediaUrl?: string;
    mediaType?: string;
    cronExpression?: string;
    recurrenceRule?: string;
}

const TIME_FORMAT = "YYYY-MM-DD HH:mm:ss";

function JidBadges({ jid }: { jid: string }) {
    return (
        <>
            {jid.split("@")[0]}
            {jid.includes("@g.us") ? <span className="text-xs px-2 py-0.5 rounded font-normal bg-zinc-100 text-zinc-800">Grupo</span> : null}
            {jid.includes("@newsletter") ? <span className="text-xs px-2 py-0.5 rounded font-normal bg-orange-100 text-orange-800">Canal</span> : null}
        </>
    );
}

export function PendingList({ messages, loading, timezone, onEdit, onDelete }: {
    messages: ScheduledMessage[];
    loading: boolean;
    timezone: string;
    onEdit: (msg: ScheduledMessage) => void;
    onDelete: (id: string) => void;
}) {
    if (loading) return <div className="text-center p-8">Carregando...</div>;
    if (messages.length === 0) return <div className="text-center p-8 text-muted-foreground border rounded bg-zinc-50">Nenhuma mensagem pendente.</div>;
    return (
        <div className="grid gap-4">
            {messages.map(msg => (
                <Card key={msg.id}>
                    <CardContent className="flex flex-col sm:flex-row justify-between p-4 gap-4">
                        <div>
                            <div className="font-bold flex items-center gap-2">
                                <JidBadges jid={msg.jid} />
                                <span className="text-xs px-2 py-0.5 rounded font-normal bg-yellow-100 text-yellow-800">{msg.status}</span>
                                {msg.cronExpression && <span className="text-xs px-2 py-0.5 rounded font-normal bg-zinc-100 text-zinc-800">Recorrente</span>}
                            </div>
                            <div className="text-sm font-medium mt-1">{msg.content || "[Somente mídia]"}</div>
                            <div className="text-xs text-muted-foreground mt-1">Próxima execução: {moment(msg.sendAt).tz(timezone).format(TIME_FORMAT)}</div>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => onEdit(msg)}>Editar</Button>
                            <Button variant="ghost" size="icon" onClick={() => onDelete(msg.id)} className="text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /></Button>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

export function HistoryList({ messages, loading, timezone, onDelete }: {
    messages: ScheduledMessage[];
    loading: boolean;
    timezone: string;
    onDelete: (id: string) => void;
}) {
    if (loading) return <div className="text-center p-8">Carregando...</div>;
    if (messages.length === 0) return <div className="text-center p-8 text-muted-foreground border rounded bg-zinc-50">Nenhum histórico encontrado.</div>;
    return (
        <div className="grid gap-4">
            {messages.map(msg => (
                <Card key={msg.id} className="opacity-80">
                    <CardContent className="flex flex-col sm:flex-row justify-between p-4 gap-4">
                        <div>
                            <div className="font-bold flex items-center gap-2">
                                <JidBadges jid={msg.jid} />
                                {msg.status === "SENT"
                                    ? <span className="text-xs px-2 py-0.5 rounded font-normal bg-green-100 text-green-800 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/>  Enviadas</span>
                                    : <span className="text-xs px-2 py-0.5 rounded font-normal bg-red-100 text-red-800 flex items-center gap-1"><XCircle className="w-3 h-3"/>  Falhas</span>}
                            </div>
                            <div className="text-sm font-medium mt-1">{msg.content || "[Somente mídia]"}</div>
                            <div className="text-xs text-muted-foreground mt-1">Processado em: {moment(msg.sendAt).tz(timezone).format(TIME_FORMAT)}</div>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="ghost" size="icon" onClick={() => onDelete(msg.id)} className="text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /></Button>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

export function DeleteDialog({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
    return (
        <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Excluir registro?</AlertDialogTitle>
                    <AlertDialogDescription>Tem certeza de que deseja excluir este registro de agendamento?</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm} className="bg-red-600">Excluir</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
