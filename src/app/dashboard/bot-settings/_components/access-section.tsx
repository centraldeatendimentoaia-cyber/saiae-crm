"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, ShieldCheck, UserCheck } from "lucide-react";
import { SaveButton } from "./save-button";
import type { SectionProps, JidListName } from "./types";

export function AccessSection({ config, update, newJid, onNewJidChange, onAddJid, onRemoveJid, saving, disabled, onSave }: SectionProps & {
    newJid: string;
    onNewJidChange: (v: string) => void;
    onAddJid: (list: JidListName) => void;
    onRemoveJid: (list: JidListName, jid: string) => void;
    saving: boolean;
    disabled: boolean;
    onSave: () => void;
}) {
    const listName: JidListName = config.botMode === 'SPECIFIC' ? 'botAllowedJids' : 'botBlockedJids';

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    Modo do bot e controle de acesso
                </CardTitle>
                <CardDescription>Defina quem pode interagir com o bot e usar comandos.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid gap-2">
                    <Label>Nome do bot</Label>
                    <Input
                        placeholder="Saiaê Bot"
                        value={config.botName}
                        onChange={(e) => update({ botName: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">O nome exibido pelo bot nas respostas automáticas.</p>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label>Prefixo de comando</Label>
                        <Input
                            className="max-w-[100px]"
                            placeholder="#"
                            maxLength={3}
                            value={config.prefix}
                            onChange={(e) => update({ prefix: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">O caractere de prefixo dos comandos do bot.</p>
                    </div>
                    <div className="grid gap-2">
                        <Label>Modo de interação do bot</Label>
                        <Select value={config.botMode} onValueChange={(v) => update({ botMode: v })}>
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione o modo" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">Público (todos)</SelectItem>
                                <SelectItem value="OWNER">Privado (somente o dono)</SelectItem>
                                <SelectItem value="SPECIFIC">Lista de permitidos (JIDs selecionados)</SelectItem>
                                <SelectItem value="BLACKLIST">Lista de bloqueados (bloquear JIDs)</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">Controle quem pode acionar os comandos do bot.</p>
                    </div>
                </div>

                {(config.botMode === 'SPECIFIC' || config.botMode === 'BLACKLIST') && (
                    <div className="space-y-4 pt-4 border-t border-border/50 animate-in fade-in slide-in-from-top-1 duration-200">
                        <Label className="flex items-center gap-2">
                            <UserCheck className="h-4 w-4" />
                            {config.botMode === 'SPECIFIC' ? "Números permitidos" : "Números bloqueados"}
                        </Label>
                        <div className="flex gap-2">
                            <Input
                                placeholder="628123456789@s.whatsapp.net"
                                value={newJid}
                                onChange={(e) => onNewJidChange(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && onAddJid(listName)}
                            />
                            <Button variant="outline" size="icon" onClick={() => onAddJid(listName)}>
                                <Plus className="h-4 w-4" />
                            </Button>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {config[listName].map(jid => (
                                <div key={jid} className="flex items-center gap-1.5 bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-xs font-medium">
                                    {jid}
                                    <button onClick={() => onRemoveJid(listName, jid)} className="text-muted-foreground hover:text-destructive transition-colors">
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>
                            ))}
                            {config[listName].length === 0 && (
                                <p className="text-xs text-muted-foreground italic">Nenhum número adicionado ainda.</p>
                            )}
                        </div>
                    </div>
                )}

                <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-border/50">
                    <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                        <Label htmlFor="enable-ping" className="flex flex-col space-y-1 cursor-pointer">
                            <span className="font-medium">Comando ping</span>
                            <span className="font-normal text-[10px] text-muted-foreground">Responder ao comando {config.prefix}ping</span>
                        </Label>
                        <Switch id="enable-ping" checked={config.enablePing}
                            onCheckedChange={c => update({ enablePing: c })} />
                    </div>
                    <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                        <Label htmlFor="enable-uptime" className="flex flex-col space-y-1 cursor-pointer">
                            <span className="font-medium">Comando uptime</span>
                            <span className="font-normal text-[10px] text-muted-foreground">Responder ao comando {config.prefix}uptime</span>
                        </Label>
                        <Switch id="enable-uptime" checked={config.enableUptime}
                            onCheckedChange={c => update({ enableUptime: c })} />
                    </div>
                </div>

                <div className="pt-2">
                    <SaveButton className="w-full sm:w-auto" onClick={onSave} loading={saving} disabled={disabled}>
                        Salvar configuração do bot
                    </SaveButton>
                </div>
            </CardContent>
        </Card>
    );
}
