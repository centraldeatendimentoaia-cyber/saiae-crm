"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { EventSwitchGrid } from "./event-switch-grid";

export interface EditFormValues {
    name: string;
    url: string;
    secret: string;
    events: string[];
}

export function EditWebhookDialog({ open, onOpenChange, values, onChange, onSave }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    values: EditFormValues;
    onChange: (values: EditFormValues) => void;
    onSave: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Editar webhook</DialogTitle>
                    <DialogDescription>Modifique a configuração do endpoint do webhook e os eventos assinados.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Nome</Label>
                            <Input placeholder="Meu servidor" value={values.name} onChange={(e) => onChange({ ...values, name: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>URL do webhook</Label>
                            <Input placeholder="https://exemplo.com/webhook" value={values.url} onChange={(e) => onChange({ ...values, url: e.target.value })} />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Segredo (opcional, para assinatura HMAC)</Label>
                        <Input placeholder="sua-chave-secreta" value={values.secret} onChange={(e) => onChange({ ...values, secret: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <Label>Eventos</Label>
                        <EventSwitchGrid
                            className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                            events={values.events}
                            onChange={(events) => onChange({ ...values, events })}
                        />
                    </div>
                </div>
                <DialogFooter className="gap-2">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={onSave}>Salvar alterações</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function DeleteWebhookDialog({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
    return (
        <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Tem certeza absoluta?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Esta ação não pode ser desfeita. A configuração do webhook será excluída permanentemente.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm} className="bg-red-600 hover:bg-red-700">Excluir</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
