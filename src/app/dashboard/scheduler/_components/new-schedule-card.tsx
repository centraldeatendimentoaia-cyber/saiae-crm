"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmojiTextarea } from "@/components/emoji-textarea";
import { MediaUpload } from "@/components/media-upload";
import { Label } from "@/components/ui/label";
import { parseRecipients } from "@/lib/phone";
import { RecurrenceForm } from "./recurrence-form";
import { JidTypeRadio, MediaTypeSelect } from "./schedule-fields";
import type { ScheduleFormValues } from "./schedule-form";

export function NewScheduleCard({ values, onChange, onCancel, onSubmit }: {
    values: ScheduleFormValues;
    onChange: (patch: Partial<ScheduleFormValues>) => void;
    onCancel: () => void;
    onSubmit: () => void;
}) {
    const recipients = parseRecipients(values.jid).length;
    return (
        <Card className="border-2 border-primary/20">
            <CardHeader>
                <CardTitle>Agendar nova mensagem</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-3">
                    <JidTypeRadio idPrefix="new" label="Destinatários" value={values.jidType} onChange={(v) => onChange({ jidType: v })} />
                    {values.jidType === "personal" ? (
                        <>
                            <Textarea
                                value={values.jid}
                                onChange={e => onChange({ jid: e.target.value })}
                                placeholder={"5511999999999\n5511988888888"}
                                className="min-h-[120px] font-mono"
                            />
                            <p className="text-xs text-muted-foreground">
                                {recipients} números identificados. Um por linha ou separados por vírgula.
                                {recipients > 1 && " As mensagens saem uma a uma, com alguns segundos entre elas."}
                            </p>
                        </>
                    ) : (
                        <Input value={values.jid} onChange={e => onChange({ jid: e.target.value })} placeholder={values.jidType === 'group' ? "120363... (ID do grupo)" : "120363... (ID do canal)"} />
                    )}
                </div>

                <RecurrenceForm values={values} onChange={onChange} />

                <div className="space-y-2 mt-4">
                    <Label>Mensagem (opcional)</Label>
                    <EmojiTextarea value={values.content} onValueChange={(v) => onChange({ content: v })} placeholder="Olá!" className="min-h-[110px]" />
                </div>

                <div className="space-y-2 mt-4">
                    <Label>Imagem (opcional)</Label>
                    <MediaUpload
                        value={values.mediaUrl.startsWith("/api/uploads/") ? values.mediaUrl : ""}
                        onChange={u => onChange(u ? { mediaUrl: u, mediaType: "image" } : { mediaUrl: u })}
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Ou URL da mídia (opcional)</Label>
                        <Input value={values.mediaUrl} onChange={e => onChange({ mediaUrl: e.target.value })} placeholder="https://..." />
                    </div>
                    <MediaTypeSelect value={values.mediaType} onChange={(v) => onChange({ mediaType: v })} />
                </div>
                <div className="flex justify-end gap-2 mt-4">
                    <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
                    <Button onClick={onSubmit} disabled={(!values.content && !values.mediaUrl) || !values.jid}>Agendar</Button>
                </div>
            </CardContent>
        </Card>
    );
}
