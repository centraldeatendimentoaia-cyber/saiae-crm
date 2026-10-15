"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { WAP_COLORS } from "./types";

function ColorPicker({ value, onChange }: { value: number; onChange: (index: number) => void }) {
    return (
        <div className="space-y-2">
            <Label>Cor</Label>
            <div className="grid grid-cols-10 gap-1.5 mt-2">
                {WAP_COLORS.map((hex, index) => (
                    <div
                        key={index}
                        onClick={() => onChange(index)}
                        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full cursor-pointer transition-all border-2 ${value === index ? 'border-foreground scale-110 ring-2 ring-foreground/20' : 'border-transparent hover:scale-105'}`}
                        style={{ backgroundColor: hex }}
                    />
                ))}
            </div>
        </div>
    );
}

// Dialogo de criar/editar etiqueta. `trigger` e opcional (o de criar usa um botao).
export function LabelFormDialog({ open, onOpenChange, title, description, submitLabel, name, onNameChange, color, onColorChange, submitting, onSubmit, trigger }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    submitLabel: string;
    name: string;
    onNameChange: (v: string) => void;
    color: number;
    onColorChange: (v: number) => void;
    submitting: boolean;
    onSubmit: () => void;
    trigger?: ReactNode;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {trigger}
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label>Nome da etiqueta</Label>
                        <Input
                            value={name}
                            onChange={(e) => onNameChange(e.target.value)}
                            placeholder="ex.: Cliente VIP"
                        />
                    </div>
                    <ColorPicker value={color} onChange={onColorChange} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={onSubmit} disabled={submitting || !name.trim()}>
                        {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                        {submitLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
