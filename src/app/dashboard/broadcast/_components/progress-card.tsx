"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, CheckCircle2, XCircle, Radio, Clock, AlertTriangle } from "lucide-react";
import { formatJid, type BroadcastProgress } from "./types";

export function ProgressCard({ progress, onCancel }: { progress: BroadcastProgress; onCancel: () => void }) {
    return (
        <Card className={`border-2 transition-colors ${
            progress.status === "completed"
                ? (progress.failed === 0 ? "border-green-500/30 bg-green-50/30 dark:bg-green-950/10" : "border-yellow-500/30 bg-yellow-50/30 dark:bg-yellow-950/10")
                : "border-zinc-500/30 bg-zinc-50/30 dark:bg-zinc-950/10"
        }`}>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                    {progress.status === "running" ? (
                        <><Radio className="h-5 w-5 text-zinc-500 animate-pulse" /><span>Disparo em andamento</span></>
                    ) : (progress.status === "stopped" || progress.status === "cancelled") ? (
                        <><AlertTriangle className="h-5 w-5 text-red-500" /><span>{progress.status === "cancelled" ? "Disparo cancelado" : "Disparo interrompido"}</span></>
                    ) : progress.deferred ? (
                        <><Clock className="h-5 w-5 text-yellow-500" /><span>Continua automaticamente</span></>
                    ) : progress.failed === 0 ? (
                        <><CheckCircle2 className="h-5 w-5 text-green-500" /><span>Disparo concluído</span></>
                    ) : (
                        <><AlertTriangle className="h-5 w-5 text-yellow-500" /><span>Disparo concluído com erros</span></>
                    )}
                </CardTitle>
                <CardDescription className="flex items-center justify-between gap-2">
                    <span>ID: {progress.broadcastId}</span>
                    {progress.status === "running" && (
                        <Button size="sm" variant="outline" onClick={onCancel}>Cancelar disparo</Button>
                    )}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Progresso</span>
                        <span className="font-mono font-medium">
                            {progress.sent + progress.failed} / {progress.total} ({progress.progress || 0}%)
                        </span>
                    </div>
                    <Progress value={progress.progress || 0} className="h-3" />
                </div>

                <div className="grid grid-cols-3 gap-3">
                    <div className="bg-background rounded-lg p-3 text-center border">
                        <div className="text-2xl font-bold text-green-600">{progress.sent}</div>
                        <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                            <CheckCircle2 className="h-3 w-3" />  Enviadas
                        </div>
                    </div>
                    <div className="bg-background rounded-lg p-3 text-center border">
                        <div className="text-2xl font-bold text-red-500">{progress.failed}</div>
                        <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                            <XCircle className="h-3 w-3" />  Falhas
                        </div>
                    </div>
                    <div className="bg-background rounded-lg p-3 text-center border">
                        <div className="text-2xl font-bold text-muted-foreground">
                            {progress.total - progress.sent - progress.failed}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                            <Clock className="h-3 w-3" />  Pendentes
                        </div>
                    </div>
                </div>

                {progress.note && (
                    <p className="rounded-lg border bg-muted/50 px-3 py-2 text-sm">{progress.note}</p>
                )}

                {progress.status === "running" && progress.current && (
                    <div className="flex items-center gap-2 text-sm px-3 py-2 bg-muted/50 rounded-lg">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-zinc-500" />
                        <span className="text-muted-foreground">Enviando agora:</span>
                        <span className="font-mono font-medium">{formatJid(progress.current)}</span>
                    </div>
                )}

                {progress.status !== "running" && progress.errors && progress.errors.length > 0 && (
                    <div className="space-y-2">
                        <h4 className="text-sm font-semibold text-red-600 flex items-center gap-1.5">
                            <XCircle className="h-4 w-4" />  Falhas ({progress.errors.length})
                        </h4>
                        <div className="max-h-40 overflow-y-auto bg-red-50 dark:bg-red-950/30 rounded-lg p-2 space-y-1">
                            {progress.errors.map((err, i) => (
                                <div key={i} className="flex justify-between items-center text-xs py-1 px-2 bg-background/60 rounded">
                                    <span className="font-mono">{formatJid(err.jid)}</span>
                                    <span className="text-red-500 truncate ml-2 max-w-[200px]">{err.error}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
