"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmojiTextarea } from "@/components/emoji-textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RecurrenceForm } from "./recurrence-form";
import { JidTypeRadio, MediaTypeSelect } from "./schedule-fields";
import type { ScheduleFormValues } from "./schedule-form";

export function EditScheduleDialog({ open, onClose, values, onChange, onSubmit }: {
    open: boolean;
    onClose: () => void;
    values: ScheduleFormValues;
    onChange: (patch: Partial<ScheduleFormValues>) => void;
    onSubmit: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={o => !o && onClose()}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Editar agendamento</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-3">
                        <JidTypeRadio idPrefix="edit" label="JID do destinatário" value={values.jidType} onChange={(v) => onChange({ jidType: v })} />
                        <Input
                            value={values.jid}
                            onChange={e => onChange({ jid: e.target.value })}
                            placeholder={values.jidType === 'group' ? "120363... (ID do grupo)" : values.jidType === 'newsletter' ? "120363... (ID do canal)" : "62812345678"}
                        />
                    </div>

                    <RecurrenceForm values={values} onChange={onChange} />

                    <div className="space-y-2 mt-4">
                        <Label>Mensagem (opcional)</Label>
                        <EmojiTextarea value={values.content} onValueChange={(v) => onChange({ content: v })} className="min-h-[110px]" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>URL da mídia (opcional)</Label>
                            <Input value={values.mediaUrl} onChange={e => onChange({ mediaUrl: e.target.value })} />
                        </div>
                        <MediaTypeSelect value={values.mediaType} onChange={(v) => onChange({ mediaType: v })} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                    <Button onClick={onSubmit} disabled={(!values.content && !values.mediaUrl) || !values.jid}>Salvar alterações</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
