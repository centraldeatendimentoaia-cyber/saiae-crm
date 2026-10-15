"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";

export interface RecurrenceFormProps {
    isRec: string; setRec: (v: string) => void;
    type: string; setType: (v: string) => void;
    mins: number; setMins: (v: number) => void;
    hrs: number; setHrs: (v: number) => void;
    days: number[]; setDays: (v: number[]) => void;
    cron: string; setCron: (v: string) => void;
    sendAtStr: string; setSendAtStr: (v: string) => void;
    sendTimeStr: string; setSendTimeStr: (v: string) => void;
}

export function RecurrenceForm({
    isRec, setRec, type, setType, mins, setMins, hrs, setHrs, days, setDays, cron, setCron,
    sendAtStr, setSendAtStr, sendTimeStr, setSendTimeStr,
}: RecurrenceFormProps) {
    return (
        <div className="space-y-4 border p-4 rounded-md bg-zinc-50 mt-4">
            <Label className="font-semibold text-base">Tipo de agendamento</Label>
            <RadioGroup value={isRec} onValueChange={setRec} className="flex gap-4">
                <div className="flex items-center space-x-2">
                    <RadioGroupItem value="once" id={`r-once-${type}`} />
                    <Label htmlFor={`r-once-${type}`}>Único</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <RadioGroupItem value="recurring" id={`r-rec-${type}`} />
                    <Label htmlFor={`r-rec-${type}`}>Recorrente</Label>
                </div>
            </RadioGroup>

            {isRec === "once" && (
                <div className="space-y-2 mt-4 pt-4 border-t border-zinc-200">
                    <Label>Enviar em (data e hora)</Label>
                    <Input type="datetime-local" value={sendAtStr} onChange={e => setSendAtStr(e.target.value)} />
                    <p className="text-xs text-muted-foreground">A data e hora exatas em que esta mensagem será enviada.</p>
                </div>
            )}

            {isRec === "recurring" && (
                <div className="space-y-4 pt-4 mt-2 border-t border-zinc-200">
                    <Label className="font-medium">Intervalo de repetição</Label>
                    <Select value={type} onValueChange={setType}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="minutes">A cada X minutos</SelectItem>
                            <SelectItem value="hours">A cada X horas</SelectItem>
                            <SelectItem value="days">Dias específicos da semana</SelectItem>
                            <SelectItem value="cron">Cron personalizado</SelectItem>
                        </SelectContent>
                    </Select>

                    {type === "minutes" && (
                        <div className="flex items-center gap-2">
                            <Label>A cada</Label>
                            <Input type="number" min={1} value={mins} onChange={e => setMins(parseInt(e.target.value) || 1)} className="w-20" />
                            <Label>Minutos</Label>
                        </div>
                    )}

                    {type === "hours" && (
                        <div className="flex items-center gap-2">
                            <Label>A cada</Label>
                            <Input type="number" min={1} value={hrs} onChange={e => setHrs(parseInt(e.target.value) || 1)} className="w-20" />
                            <Label>Horas</Label>
                        </div>
                    )}

                    {type === "days" && (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label>Selecione os dias</Label>
                                <div className="flex flex-wrap gap-4">
                                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                                        <div key={d} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`d-${d}-${type}`}
                                                checked={days.includes(i)}
                                                onCheckedChange={(c) => {
                                                    if (c) setDays([...days, i]);
                                                    else setDays(days.filter(x => x !== i));
                                                }}
                                            />
                                            <Label htmlFor={`d-${d}-${type}`}>{d}</Label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-2 pt-2 border-t border-zinc-200">
                                <Label>Horário do dia</Label>
                                <Input type="time" value={sendTimeStr} onChange={e => setSendTimeStr(e.target.value)} className="w-32" />
                            </div>
                        </div>
                    )}

                    {type === "cron" && (
                        <div className="space-y-2">
                            <Label>Expressão cron</Label>
                            <Input value={cron} onChange={e => setCron(e.target.value)} placeholder="0 12 * * *" />
                        </div>
                    )}

                    {type !== "days" && (
                        <p className="text-xs text-muted-foreground mt-2">
                            O agendamento será avaliado a partir do horário atual.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
