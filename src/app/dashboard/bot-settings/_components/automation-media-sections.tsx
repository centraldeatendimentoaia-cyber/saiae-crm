"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Zap, MessageSquarePlus } from "lucide-react";
import { SaveButton } from "./save-button";
import type { SectionProps } from "./types";

interface SaveProps {
    saving: boolean;
    disabled: boolean;
    onSave: () => void;
}

export function AutomationSection({ config, update, saving, disabled, onSave }: SectionProps & SaveProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-yellow-500" />
                    Automação e presença
                </CardTitle>
                <CardDescription>Automação avançada do bot e personalização de presença.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid sm:grid-cols-2 gap-4">
                    <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                        <Label htmlFor="always-online" className="flex flex-col space-y-1 cursor-pointer">
                            <span className="font-medium">Sempre online</span>
                            <span className="font-normal text-[10px] text-muted-foreground">Permanecer "Online" mesmo quando inativo.</span>
                        </Label>
                        <Switch id="always-online" checked={config.alwaysOnline}
                            onCheckedChange={c => update({ alwaysOnline: c })} />
                    </div>
                    <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                        <Label htmlFor="auto-read" className="flex flex-col space-y-1 cursor-pointer">
                            <span className="font-medium">Leitura automática (tique azul)</span>
                            <span className="font-normal text-[10px] text-muted-foreground">Marcar mensagens como lidas automaticamente.</span>
                        </Label>
                        <Switch id="auto-read" checked={config.autoRead}
                            onCheckedChange={c => update({ autoRead: c })} />
                    </div>
                </div>

                <div className="space-y-2 border-t border-border/50 pt-4">
                    <Label className="flex items-center gap-2">
                        <MessageSquarePlus className="h-4 w-4 text-primary" />
                        Mensagem de boas-vindas (Beta)
                    </Label>
                    <Textarea
                        placeholder="Olá! Bem-vindo(a)! Como posso ajudar você hoje?"
                        className="min-h-[100px]"
                        value={config.welcomeMessage}
                        onChange={(e) => update({ welcomeMessage: e.target.value })}
                    />
                    <p className="text-[10px] text-muted-foreground">Enviada automaticamente aos usuários quando falam com este bot pela primeira vez.</p>
                </div>

                <div className="pt-2">
                    <SaveButton className="w-full sm:w-auto" onClick={onSave} loading={saving} disabled={disabled}>
                        Salvar configurações de automação
                    </SaveButton>
                </div>
            </CardContent>
        </Card>
    );
}

export function MediaSection({ config, update, saving, disabled, onSave }: SectionProps & SaveProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Mídia e figurinhas</CardTitle>
                <CardDescription>Configure como o bot trata mídias e a conversão em figurinhas.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid sm:grid-cols-2 gap-4">
                    <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                        <Label htmlFor="enable-sticker" className="flex flex-col space-y-1 cursor-pointer">
                            <span className="font-medium">Imagem para figurinha</span>
                            <span className="font-normal text-xs text-muted-foreground">Converter imagens automaticamente</span>
                        </Label>
                        <Switch id="enable-sticker" checked={config.enableSticker}
                            onCheckedChange={c => update({ enableSticker: c })} />
                    </div>
                    <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                        <Label htmlFor="enable-video-sticker" className="flex flex-col space-y-1 cursor-pointer">
                            <span className="font-medium">Vídeo para figurinha</span>
                            <span className="font-normal text-xs text-muted-foreground">Converter vídeos curtos automaticamente</span>
                        </Label>
                        <Switch id="enable-video-sticker" checked={config.enableVideoSticker}
                            onCheckedChange={c => update({ enableVideoSticker: c })} />
                    </div>
                </div>

                <div className="grid gap-2 border-t border-border/50 pt-4">
                    <Label>Duração máxima do vídeo da figurinha: <strong>{config.maxStickerDuration}s</strong></Label>
                    <Slider
                        value={[config.maxStickerDuration]}
                        onValueChange={([v]) => update({ maxStickerDuration: v })}
                        min={3}
                        max={30}
                        step={1}
                    />
                    <p className="text-xs text-muted-foreground">Duração máxima do vídeo (em segundos) permitida para conversão em figurinha.</p>
                </div>

                <div className="grid gap-2 border-t border-border/50 pt-4">
                    <Label>Chave da API Remove.bg (opcional)</Label>
                    <Input
                        type="password"
                        placeholder="Informe sua chave da API Remove.bg"
                        value={config.removeBgApiKey || ""}
                        onChange={(e) => update({ removeBgApiKey: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">Habilita a remoção de fundo nas figurinhas (use <code className="bg-muted px-1 rounded">nobg</code>  na legenda).</p>
                </div>

                <div className="pt-2">
                    <SaveButton className="w-full sm:w-auto" onClick={onSave} loading={saving} disabled={disabled}>
                        Salvar configurações de mídia
                    </SaveButton>
                </div>
            </CardContent>
        </Card>
    );
}
