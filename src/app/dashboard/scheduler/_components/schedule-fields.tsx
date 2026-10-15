"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

/** Pessoal / Grupo / Canal. `idPrefix` mantém os ids únicos quando há dois formulários na tela. */
export function JidTypeRadio({ idPrefix, label, value, onChange }: {
    idPrefix: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div className="flex justify-between items-center">
            <Label>{label}</Label>
            <RadioGroup value={value} onValueChange={onChange} className="flex gap-4">
                <div className="flex items-center space-x-2">
                    <RadioGroupItem value="personal" id={`${idPrefix}-personal`} />
                    <Label htmlFor={`${idPrefix}-personal`} className="cursor-pointer">Pessoal</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <RadioGroupItem value="group" id={`${idPrefix}-group`} />
                    <Label htmlFor={`${idPrefix}-group`} className="cursor-pointer">Grupo</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <RadioGroupItem value="newsletter" id={`${idPrefix}-newsletter`} />
                    <Label htmlFor={`${idPrefix}-newsletter`} className="cursor-pointer">Canal</Label>
                </div>
            </RadioGroup>
        </div>
    );
}

export function MediaTypeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div className="space-y-2">
            <Label>Tipo de mídia</Label>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="image">Imagem</SelectItem>
                    <SelectItem value="video">Vídeo</SelectItem>
                    <SelectItem value="document">Documento</SelectItem>
                </SelectContent>
            </Select>
        </div>
    );
}
