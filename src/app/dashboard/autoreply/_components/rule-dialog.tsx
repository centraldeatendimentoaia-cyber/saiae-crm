"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RuleFormFields } from "./rule-form-fields";
import { ruleFormValid, type RuleFormValues } from "./types";

// Dialogo de criar/editar regra. `trigger` (opcional) é o botão que abre o de criar.
export function RuleDialog({ open, onOpenChange, title, description, submitLabel, values, onChange, responsePlaceholder, submitting, onSubmit, trigger }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    submitLabel: string;
    values: RuleFormValues;
    onChange: (values: RuleFormValues) => void;
    responsePlaceholder: string;
    submitting: boolean;
    onSubmit: () => void;
    trigger?: ReactNode;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {trigger}
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <RuleFormFields values={values} onChange={onChange} responsePlaceholder={responsePlaceholder} />
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={onSubmit} disabled={submitting || !ruleFormValid(values)}>
                        {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : submitLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
