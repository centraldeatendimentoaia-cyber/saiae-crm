"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle } from "lucide-react";

export function ScheduleDialog({ open, onOpenChange, recipientCount, delayMs, hasVariants, hasMedia, scheduleAt, onScheduleAtChange, scheduling, onSchedule }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    recipientCount: number;
    delayMs: number;
    hasVariants: boolean;
    hasMedia: boolean;
    scheduleAt: string;
    onScheduleAtChange: (v: string) => void;
    scheduling: boolean;
    onSchedule: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Agendar disparo</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        A mensagem será enviada para {recipientCount} {recipientCount === 1 ? "número" : "números"} a partir do horário escolhido, um de cada vez, com {(Math.max(3000, delayMs) / 1000).toFixed(0)} segundos ou mais entre eles.
                        Variáveis como {"{primeironome}"} são trocadas na hora do envio.
                        {hasVariants ? " As versões extras do texto saem em rodízio." : ""}{hasMedia ? " A imagem vai junto, com o texto como legenda." : ""}
                    </p>
                    <div className="space-y-2">
                        <Label htmlFor="schedule-at">Data e hora</Label>
                        <Input id="schedule-at" type="datetime-local" value={scheduleAt} onChange={e => onScheduleAtChange(e.target.value)} />
                    </div>
                    <div className="flex gap-2 justify-end pt-2">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={scheduling}>Cancelar</Button>
                        <Button onClick={onSchedule} disabled={scheduling || !scheduleAt}>
                            {scheduling ? "Agendando..." : "Agendar"}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export function RiskDialog({ open, onOpenChange, recipientCount, onConfirm }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    recipientCount: number;
    onConfirm: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-yellow-500" />Atenção: risco de bloqueio</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                    <p>Você vai enviar para <strong>{recipientCount}</strong> contatos. Disparos grandes aumentam o risco de o WhatsApp <strong>bloquear o seu número</strong>, principalmente com lista antiga, contatos que nunca falaram com você ou número novo.</p>
                    <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                        <li>Prefira clientes que já conversaram com você.</li>
                        <li>Use intervalos maiores e mais de uma versão do texto.</li>
                        <li>Evite enviar de madrugada ou à noite.</li>
                    </ul>
                    <p className="text-muted-foreground">O bloqueio de um número é responsabilidade de quem dispara. Você pode ajustar o ritmo em Configurações do bot.</p>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={onConfirm}>Entendi, iniciar disparo</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
