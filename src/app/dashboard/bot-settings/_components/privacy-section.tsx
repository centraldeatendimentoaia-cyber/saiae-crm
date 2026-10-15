"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SaveButton } from "./save-button";
import type { PrivacyConfig } from "./types";

export function PrivacySection({ config, onChange, saving, disabled, onSave }: {
    config: PrivacyConfig;
    onChange: (patch: Partial<PrivacyConfig>) => void;
    saving: boolean;
    disabled: boolean;
    onSave: () => void;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Privacidade e utilidades</CardTitle>
                <CardDescription>Configure o modo fantasma e outros recursos da sua sessão ativa.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex items-center justify-between space-x-2">
                    <Label htmlFor="ghost-mode" className="flex flex-col space-y-1">
                        <span>Modo fantasma</span>
                        <span className="font-normal text-xs text-muted-foreground">Veja status e leia mensagens sem enviar o tique azul.</span>
                    </Label>
                    <Switch id="ghost-mode" checked={config.ghostMode}
                        onCheckedChange={c => onChange({ ghostMode: c })} />
                </div>

                <div className="flex items-center justify-between space-x-2">
                    <Label htmlFor="anti-delete" className="flex flex-col space-y-1">
                        <span>Anti-exclusão</span>
                        <span className="font-normal text-xs text-muted-foreground">Mantenha as mensagens mesmo que o remetente as apague para todos.</span>
                    </Label>
                    <Switch id="anti-delete" checked={config.antiDelete}
                        onCheckedChange={c => onChange({ antiDelete: c })} />
                </div>

                <div className="pt-4">
                    <SaveButton onClick={onSave} loading={saving} disabled={disabled}>
                        Salvar configurações de privacidade
                    </SaveButton>
                </div>
            </CardContent>
        </Card>
    );
}
