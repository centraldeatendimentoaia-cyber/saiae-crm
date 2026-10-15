"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshCw, CheckCircle2, XCircle, Radio, AlertTriangle, History, Eye, Calendar } from "lucide-react";
import { formatJid, formatTime, type BroadcastLog } from "./types";

export function HistoryTab({ history, loading, onOpenDetail }: {
    history: BroadcastLog[];
    loading: boolean;
    onOpenDetail: (log: BroadcastLog) => void;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <History className="h-5 w-5" />
                    Histórico de disparos
                </CardTitle>
                <CardDescription>Histórico dos disparos enviados, armazenado permanentemente.</CardDescription>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : history.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                        <p className="text-sm">Nenhum disparo realizado ainda.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {history.map(log => (
                            <div key={log.id}
                                className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/30 transition-colors"
                            >
                                <div className="shrink-0">
                                    {log.status === "completed" ? (
                                        log.failed === 0
                                            ? <CheckCircle2 className="h-8 w-8 text-green-500" />
                                            : <AlertTriangle className="h-8 w-8 text-yellow-500" />
                                    ) : (
                                        <Radio className="h-8 w-8 text-zinc-500 animate-pulse" />
                                    )}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{log.message}</p>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                        <span className="flex items-center gap-1">
                                            <CheckCircle2 className="h-3 w-3 text-green-500" /> {log.sent}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <XCircle className="h-3 w-3 text-red-500" /> {log.failed}
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Calendar className="h-3 w-3" /> {formatTime(log.startedAt)}
                                        </span>
                                    </div>
                                </div>

                                <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onOpenDetail(log)}>
                                    <Eye className="h-4 w-4 mr-1" />  Detalhes
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export function DetailDialog({ open, onOpenChange, log, loading }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    log: BroadcastLog | null;
    loading: boolean;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {log?.status === "completed"
                            ? <CheckCircle2 className="h-5 w-5 text-green-500" />
                            : <Radio className="h-5 w-5 text-zinc-500 animate-pulse" />
                        }
                        Detalhes do disparo
                    </DialogTitle>
                </DialogHeader>

                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : log ? (
                    <div className="flex flex-col gap-4 overflow-hidden min-h-0">
                        <div className="grid grid-cols-3 gap-3">
                            <div className="bg-muted/30 rounded-lg p-3 text-center">
                                <div className="text-xl font-bold text-green-600">{log.sent}</div>
                                <div className="text-xs text-muted-foreground">Enviadas</div>
                            </div>
                            <div className="bg-muted/30 rounded-lg p-3 text-center">
                                <div className="text-xl font-bold text-red-500">{log.failed}</div>
                                <div className="text-xs text-muted-foreground">Falhas</div>
                            </div>
                            <div className="bg-muted/30 rounded-lg p-3 text-center">
                                <div className="text-xl font-bold">{log.total}</div>
                                <div className="text-xs text-muted-foreground">Total</div>
                            </div>
                        </div>

                        <div className="bg-muted/30 rounded-lg p-3">
                            <p className="text-xs text-muted-foreground mb-1">Mensagem:</p>
                            <p className="text-sm whitespace-pre-wrap break-words">{log.message}</p>
                        </div>

                        <div className="flex gap-4 text-xs text-muted-foreground">
                            <span>Iniciado em: {formatTime(log.startedAt)}</span>
                            {log.completedAt && <span>Concluído em: {formatTime(log.completedAt)}</span>}
                        </div>

                        {log.recipients && log.recipients.length > 0 && (
                            <div className="flex-1 overflow-y-auto min-h-0">
                                <h4 className="text-sm font-semibold mb-2">Destinatários ({log.recipients.length})</h4>
                                <div className="space-y-1">
                                    {log.recipients.map(r => (
                                        <div key={r.id}
                                            className={`flex items-center justify-between gap-2 text-xs py-1.5 px-2 rounded ${
                                                r.status === "sent" ? "bg-green-500/5" :
                                                r.status === "failed" ? "bg-red-500/5" : "bg-muted/30"
                                            }`}
                                        >
                                            <span className="font-mono truncate">{formatJid(r.jid)}</span>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className={`px-1.5 py-0.5 rounded font-medium ${
                                                    r.status === "sent" ? "text-green-600 bg-green-500/10" :
                                                    r.status === "failed" ? "text-red-500 bg-red-500/10" : "text-muted-foreground bg-muted/50"
                                                }`}>
                                                    {r.status}
                                                </span>
                                                {r.error && (
                                                    <span className="text-red-500 max-w-[200px] truncate" title={r.error}>{r.error}</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
