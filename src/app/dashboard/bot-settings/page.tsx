"use client";

import { useState, useEffect } from "react";
import { useSession as useSessionProvider } from "@/components/dashboard/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { RefreshCw, Save, AlertCircle, Bot, X, Plus, ShieldCheck, Zap, UserCheck, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { SessionGuard } from "@/components/dashboard/session-guard";

export default function BotSettingsPage() {
    const { sessionId } = useSessionProvider();

    const [botConfig, setBotConfig] = useState({
        botName: "Saiaê Bot",
        prefix: "#",
        enableSticker: true,
        enableVideoSticker: true,
        maxStickerDuration: 10,
        enablePing: true,
        enableUptime: true,
        removeBgApiKey: "",
        botMode: "OWNER",
        autoReplyMode: "ALL",
        antiSpamEnabled: true,
        spamLimit: 5,
        spamInterval: 10,
        spamDelayMin: 1000,
        spamDelayMax: 3000,
        safeDelayMin: 10,
        safeDelayMax: 40,
        safeBatchSize: 25,
        safeBatchPause: 3,
        safeStartHour: 9,
        safeEndHour: 19,

        // New fields
        welcomeMessage: "",
        autoRead: false,
        alwaysOnline: false,
        botAllowedJids: [] as string[],
        botBlockedJids: [] as string[],
        autoReplyAllowedJids: [] as string[],
        autoReplyBlockedJids: [] as string[],
    });
    const [botLoading, setBotLoading] = useState(false);

    const [newJid, setNewJid] = useState("");

    const [privacyConfig, setPrivacyConfig] = useState({
        ghostMode: false,
        antiDelete: false,
        readReceipts: true,
    });
    const [privacyLoading, setPrivacyLoading] = useState(false);

    useEffect(() => {
        if (!sessionId) return;

        fetch(`/api/sessions/${sessionId}/bot-config`)
            .then(res => { if (!res.ok) throw new Error(); return res.json(); })
            .then(responseData => {
                const data = responseData?.data;
                if (data && !responseData.error) {
                    setBotConfig(prev => ({
                        ...prev,
                        ...data,
                        removeBgApiKey: data.removeBgApiKey || "",
                        prefix: data.prefix || "#",
                        welcomeMessage: data.welcomeMessage || "",
                        botAllowedJids: data.botAllowedJids || [],
                        botBlockedJids: data.botBlockedJids || [],
                        autoReplyAllowedJids: data.autoReplyAllowedJids || [],
                        autoReplyBlockedJids: data.autoReplyBlockedJids || [],
                    }));
                }
            })
            .catch(() => { });

        fetch(`/api/sessions/${sessionId}/settings`)
            .then(res => { if (!res.ok) throw new Error(); return res.json(); })
            .then(responseData => {
                const data = responseData?.data;
                if (data && !responseData.error) {
                    setPrivacyConfig({
                        ghostMode: data.config?.ghostMode || false,
                        antiDelete: data.config?.antiDelete || false,
                        readReceipts: data.config?.readReceipts ?? true
                    });
                }
            })
            .catch(() => { });
    }, [sessionId]);

    const handleSaveBot = async () => {
        if (!sessionId) return;
        setBotLoading(true);
        try {
            const res = await fetch(`/api/sessions/${sessionId}/bot-config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(botConfig)
            });

            if (res.ok) {
                toast.success("Configuração do bot salva");
            } else {
                toast.error("Falha ao salvar a configuração do bot");
            }
        } catch (e) {
            console.error(e);
            toast.error("Erro ao salvar a configuração do bot");
        } finally {
            setBotLoading(false);
        }
    };

    const handleSavePrivacy = async () => {
        if (!sessionId) return;
        setPrivacyLoading(true);
        try {
            const res = await fetch(`/api/sessions/${sessionId}/settings`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    config: {
                        ghostMode: privacyConfig.ghostMode,
                        antiDelete: privacyConfig.antiDelete,
                        readReceipts: privacyConfig.readReceipts
                    }
                })
            });

            if (res.ok) {
                toast.success("Configurações de privacidade salvas");
            } else {
                toast.error("Falha ao salvar as configurações de privacidade");
            }
        } catch (e) {
            console.error(e);
            toast.error("Erro ao salvar as configurações de privacidade");
        } finally {
            setPrivacyLoading(false);
        }
    };

    const addJid = (listName: 'botAllowedJids' | 'botBlockedJids' | 'autoReplyAllowedJids' | 'autoReplyBlockedJids') => {
        if (!newJid || !newJid.trim()) return;
        let formatted = newJid.trim();
        if (!formatted.includes('@')) formatted += '@s.whatsapp.net';

        if (!botConfig[listName].includes(formatted)) {
            setBotConfig(prev => ({
                ...prev,
                [listName]: [...prev[listName], formatted]
            }));
        }
        setNewJid("");
    };

    const removeJid = (listName: 'botAllowedJids' | 'botBlockedJids' | 'autoReplyAllowedJids' | 'autoReplyBlockedJids', jid: string) => {
        setBotConfig(prev => ({
            ...prev,
            [listName]: prev[listName].filter(item => item !== jid)
        }));
    };

    const inputClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div>
                    <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Configurações do Bot</h2>
                    <p className="text-muted-foreground text-sm mt-1">Configure os recursos do bot e a privacidade da sessão de WhatsApp ativa.</p>
                </div>

                {/* Bot Mode & Access Section */}
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
                                    value={botConfig.botName}
                                    onChange={(e) => setBotConfig(prev => ({ ...prev, botName: e.target.value }))}
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
                                        value={botConfig.prefix}
                                        onChange={(e) => setBotConfig(prev => ({ ...prev, prefix: e.target.value }))}
                                    />
                                    <p className="text-xs text-muted-foreground">O caractere de prefixo dos comandos do bot.</p>
                                </div>
                                <div className="grid gap-2">
                                    <Label>Modo de interação do bot</Label>
                                    <Select
                                        value={botConfig.botMode}
                                        onValueChange={(v: any) => setBotConfig(prev => ({ ...prev, botMode: v }))}
                                    >
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

                            {(botConfig.botMode === 'SPECIFIC' || botConfig.botMode === 'BLACKLIST') && (
                                <div className="space-y-4 pt-4 border-t border-border/50 animate-in fade-in slide-in-from-top-1 duration-200">
                                    <Label className="flex items-center gap-2">
                                        <UserCheck className="h-4 w-4" />
                                        {botConfig.botMode === 'SPECIFIC' ? "Números permitidos" : "Números bloqueados"}
                                    </Label>
                                    <div className="flex gap-2">
                                        <Input
                                            placeholder="628123456789@s.whatsapp.net"
                                            value={newJid}
                                            onChange={(e) => setNewJid(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && addJid(botConfig.botMode === 'SPECIFIC' ? 'botAllowedJids' : 'botBlockedJids')}
                                        />
                                        <Button variant="outline" size="icon" onClick={() => addJid(botConfig.botMode === 'SPECIFIC' ? 'botAllowedJids' : 'botBlockedJids')}>
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        {(botConfig.botMode === 'SPECIFIC' ? botConfig.botAllowedJids : botConfig.botBlockedJids).map(jid => (
                                            <div key={jid} className="flex items-center gap-1.5 bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-xs font-medium">
                                                {jid}
                                                <button onClick={() => removeJid(botConfig.botMode === 'SPECIFIC' ? 'botAllowedJids' : 'botBlockedJids', jid)} className="text-muted-foreground hover:text-destructive transition-colors">
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>
                                        ))}
                                        {(botConfig.botMode === 'SPECIFIC' ? botConfig.botAllowedJids : botConfig.botBlockedJids).length === 0 && (
                                            <p className="text-xs text-muted-foreground italic">Nenhum número adicionado ainda.</p>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-border/50">
                                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                    <Label htmlFor="enable-ping" className="flex flex-col space-y-1 cursor-pointer">
                                        <span className="font-medium">Comando ping</span>
                                        <span className="font-normal text-[10px] text-muted-foreground">Responder ao comando {botConfig.prefix}ping</span>
                                    </Label>
                                    <Switch id="enable-ping" checked={botConfig.enablePing}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, enablePing: c }))} />
                                </div>
                                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                    <Label htmlFor="enable-uptime" className="flex flex-col space-y-1 cursor-pointer">
                                        <span className="font-medium">Comando uptime</span>
                                        <span className="font-normal text-[10px] text-muted-foreground">Responder ao comando {botConfig.prefix}uptime</span>
                                    </Label>
                                    <Switch id="enable-uptime" checked={botConfig.enableUptime}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, enableUptime: c }))} />
                                </div>
                            </div>

                            <div className="pt-2">
                                <Button className="w-full sm:w-auto" onClick={handleSaveBot} disabled={botLoading || !sessionId}>
                                    {botLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    
                                    Salvar configuração do bot
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Automation & Presence Section */}
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
                                    <Switch id="always-online" checked={botConfig.alwaysOnline}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, alwaysOnline: c }))} />
                                </div>
                                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                    <Label htmlFor="auto-read" className="flex flex-col space-y-1 cursor-pointer">
                                        <span className="font-medium">Leitura automática (tique azul)</span>
                                        <span className="font-normal text-[10px] text-muted-foreground">Marcar mensagens como lidas automaticamente.</span>
                                    </Label>
                                    <Switch id="auto-read" checked={botConfig.autoRead}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, autoRead: c }))} />
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
                                    value={botConfig.welcomeMessage}
                                    onChange={(e) => setBotConfig(prev => ({ ...prev, welcomeMessage: e.target.value }))}
                                />
                                <p className="text-[10px] text-muted-foreground">Enviada automaticamente aos usuários quando falam com este bot pela primeira vez.</p>
                            </div>

                            <div className="pt-2">
                                <Button className="w-full sm:w-auto" onClick={handleSaveBot} disabled={botLoading || !sessionId}>
                                    {botLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    
                                    Salvar configurações de automação
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Media & Stickers Section */}
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
                                    <Switch id="enable-sticker" checked={botConfig.enableSticker}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, enableSticker: c }))} />
                                </div>
                                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg">
                                    <Label htmlFor="enable-video-sticker" className="flex flex-col space-y-1 cursor-pointer">
                                        <span className="font-medium">Vídeo para figurinha</span>
                                        <span className="font-normal text-xs text-muted-foreground">Converter vídeos curtos automaticamente</span>
                                    </Label>
                                    <Switch id="enable-video-sticker" checked={botConfig.enableVideoSticker}
                                        onCheckedChange={c => setBotConfig(prev => ({ ...prev, enableVideoSticker: c }))} />
                                </div>
                            </div>

                            <div className="grid gap-2 border-t border-border/50 pt-4">
                                <Label>Duração máxima do vídeo da figurinha: <strong>{botConfig.maxStickerDuration}s</strong></Label>
                                <Slider
                                    value={[botConfig.maxStickerDuration]}
                                    onValueChange={([v]) => setBotConfig(prev => ({ ...prev, maxStickerDuration: v }))}
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
                                    value={botConfig.removeBgApiKey || ""}
                                    onChange={(e) => setBotConfig(prev => ({ ...prev, removeBgApiKey: e.target.value }))}
                                />
                                <p className="text-xs text-muted-foreground">Habilita a remoção de fundo nas figurinhas (use <code className="bg-muted px-1 rounded">nobg</code>  na legenda).</p>
                            </div>

                            <div className="pt-2">
                                <Button className="w-full sm:w-auto" onClick={handleSaveBot} disabled={botLoading || !sessionId}>
                                    {botLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    
                                    Salvar configurações de mídia
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Anti-Ban Protection */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <AlertCircle className="h-5 w-5 text-orange-500" />
                                
                                Proteção anti-banimento (Beta)
                            </CardTitle>
                            <CardDescription>
                                
                                Evite que seu número de WhatsApp seja detectado como spam ou banido, adicionando atrasos aleatórios inteligentes entre as mensagens enviadas. Isso vale para <strong>todas</strong>  as ações: respostas do bot, respostas automáticas, disparos, mensagens agendadas e chamadas de API desta sessão.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg bg-orange-500/5 border-orange-500/20">
                                <Label htmlFor="anti-spam" className="flex flex-col space-y-1">
                                    <span className="font-semibold text-orange-700 dark:text-orange-400">Ativar anti-spam e Modo Seguro</span>
                                    <span className="font-normal text-xs text-muted-foreground">Quando ativado, as mensagens entram em fila e são enviadas com atraso aleatório se o limite for atingido. As mensagens nunca são rejeitadas — apenas atrasadas.</span>
                                </Label>
                                <Switch id="anti-spam" checked={botConfig.antiSpamEnabled}
                                    onCheckedChange={c => setBotConfig(prev => ({ ...prev, antiSpamEnabled: c }))} />
                            </div>

                            {botConfig.antiSpamEnabled && (
                                <div className="grid gap-6 animate-in fade-in slide-in-from-top-1 duration-200">
                                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
                                        <p className="text-sm font-semibold">🛡️ Modo Seguro dos disparos</p>
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                            Vale para disparos e mensagens agendadas. Ajuste ao seu gosto: quanto mais rápido e mais mensagens, maior o risco de o WhatsApp bloquear o número. Não há limite diário.
                                        </p>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <div className="space-y-1">
                                                <Label className="text-xs">Intervalo mínimo entre mensagens</Label>
                                                <div className="flex items-center gap-2">
                                                    <Input type="number" min={1} max={600} value={botConfig.safeDelayMin}
                                                        onChange={e => setBotConfig(prev => ({ ...prev, safeDelayMin: parseInt(e.target.value) || 0 }))} />
                                                    <span className="text-xs text-muted-foreground">segundos</span>
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Intervalo máximo entre mensagens</Label>
                                                <div className="flex items-center gap-2">
                                                    <Input type="number" min={1} max={1800} value={botConfig.safeDelayMax}
                                                        onChange={e => setBotConfig(prev => ({ ...prev, safeDelayMax: parseInt(e.target.value) || 0 }))} />
                                                    <span className="text-xs text-muted-foreground">segundos</span>
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Pausa a cada (0 = sem pausa)</Label>
                                                <div className="flex items-center gap-2">
                                                    <Input type="number" min={0} max={1000} value={botConfig.safeBatchSize}
                                                        onChange={e => setBotConfig(prev => ({ ...prev, safeBatchSize: parseInt(e.target.value) || 0 }))} />
                                                    <span className="text-xs text-muted-foreground">envios</span>
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Duração da pausa</Label>
                                                <div className="flex items-center gap-2">
                                                    <Input type="number" min={1} max={120} value={botConfig.safeBatchPause}
                                                        onChange={e => setBotConfig(prev => ({ ...prev, safeBatchPause: parseInt(e.target.value) || 0 }))} />
                                                    <span className="text-xs text-muted-foreground">minutos</span>
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Enviar a partir das</Label>
                                                <div className="flex items-center gap-2">
                                                    <Input type="number" min={0} max={23} value={botConfig.safeStartHour}
                                                        onChange={e => setBotConfig(prev => ({ ...prev, safeStartHour: parseInt(e.target.value) || 0 }))} />
                                                    <span className="text-xs text-muted-foreground">h</span>
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Parar de enviar às</Label>
                                                <div className="flex items-center gap-2">
                                                    <Input type="number" min={1} max={24} value={botConfig.safeEndHour}
                                                        onChange={e => setBotConfig(prev => ({ ...prev, safeEndHour: parseInt(e.target.value) || 0 }))} />
                                                    <span className="text-xs text-muted-foreground">h</span>
                                                </div>
                                            </div>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Envia de segunda a sábado dentro do horário (Brasília); fora dele, espera e continua sozinho. Quem responde SAIR é removido dos próximos disparos. Recomendado: 10 a 40 s, pausa de 3 min a cada 25 envios.
                                        </p>
                                    </div>
                                    {/* How it works */}
                                    <div className="rounded-lg border border-zinc-500/20 bg-zinc-500/5 p-4 space-y-2">
                                        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-400">💡 Como funciona</p>
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                            
                                            O sistema conta quantas mensagens esta sessão envia dentro de uma janela de tempo. Se o número de mensagens exceder o <strong>limite</strong>  dentro da <strong>janela de tempo</strong>, cada mensagem seguinte será <strong>atrasada</strong>  por um tempo aleatório entre <strong>mín.</strong>  e <strong>máx.</strong>  de atraso. Quando a janela de tempo é reiniciada (mensagens antigas expiram), o envio volta à velocidade normal.
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            <strong>Exemplo:</strong>  Com limite = <strong>{botConfig.spamLimit}</strong>  e janela = <strong>{botConfig.spamInterval}s</strong>  → as primeiras {botConfig.spamLimit}  mensagens em {botConfig.spamInterval}  segundos são enviadas na hora. A mensagem nº{botConfig.spamLimit + 1}  e seguintes serão atrasadas em {botConfig.spamDelayMin}ms–{botConfig.spamDelayMax}ms cada.
                                        </p>
                                    </div>

                                    <div className="grid sm:grid-cols-2 gap-4">
                                        <div className="grid gap-2">
                                            <Label className="font-semibold">Limite de mensagens</Label>
                                            <Input
                                                type="number"
                                                value={botConfig.spamLimit}
                                                onChange={e => setBotConfig(prev => ({ ...prev, spamLimit: parseInt(e.target.value) || 1 }))}
                                                min={1}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                
                                                Número de mensagens permitidas em velocidade total antes de o atraso começar.
                                                <span className="text-orange-600 dark:text-orange-400">  Menor = mais seguro, porém mais lento.</span>
                                            </p>
                                        </div>
                                        <div className="grid gap-2">
                                            <Label className="font-semibold">Janela de tempo (segundos)</Label>
                                            <Input
                                                type="number"
                                                value={botConfig.spamInterval}
                                                onChange={e => setBotConfig(prev => ({ ...prev, spamInterval: parseInt(e.target.value) || 1 }))}
                                                min={1}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                
                                                A janela móvel usada para contar mensagens. Passado esse tempo, o contador reinicia naturalmente.
                                                <span className="text-orange-600 dark:text-orange-400">  Maior = mais conservador.</span>
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid sm:grid-cols-2 gap-4">
                                        <div className="grid gap-2">
                                            <Label className="font-semibold">Atraso mínimo (ms)</Label>
                                            <Input
                                                type="number"
                                                value={botConfig.spamDelayMin}
                                                onChange={e => setBotConfig(prev => ({ ...prev, spamDelayMin: parseInt(e.target.value) || 0 }))}
                                                min={0}
                                                step={100}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                
                                                Atraso aleatório mínimo aplicado. 1000 ms = 1 segundo.
                                            </p>
                                        </div>
                                        <div className="grid gap-2">
                                            <Label className="font-semibold">Atraso máximo (ms)</Label>
                                            <Input
                                                type="number"
                                                value={botConfig.spamDelayMax}
                                                onChange={e => setBotConfig(prev => ({ ...prev, spamDelayMax: parseInt(e.target.value) || 0 }))}
                                                min={0}
                                                step={100}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                
                                                Atraso aleatório máximo aplicado. 3000 ms = 3 segundos.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                                        <p className="text-xs text-muted-foreground">
                                            ⚠️ <strong>Configuração segura recomendada:</strong>  Limite <strong>5</strong>, Janela <strong>10s</strong>, Atraso <strong>1000–3000 ms</strong>. Para disparos de grande volume, use Limite <strong>3</strong>  com Atraso <strong>2000–5000 ms</strong>.
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div className="pt-2">
                                <Button onClick={handleSaveBot} disabled={botLoading || !sessionId}>
                                    {botLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    
                                    Salvar configurações de proteção
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Privacy & Utility */}
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
                                <Switch id="ghost-mode" checked={privacyConfig.ghostMode}
                                    onCheckedChange={c => setPrivacyConfig(prev => ({ ...prev, ghostMode: c }))} />
                            </div>

                            <div className="flex items-center justify-between space-x-2">
                                <Label htmlFor="anti-delete" className="flex flex-col space-y-1">
                                    <span>Anti-exclusão</span>
                                    <span className="font-normal text-xs text-muted-foreground">Mantenha as mensagens mesmo que o remetente as apague para todos.</span>
                                </Label>
                                <Switch id="anti-delete" checked={privacyConfig.antiDelete}
                                    onCheckedChange={c => setPrivacyConfig(prev => ({ ...prev, antiDelete: c }))} />
                            </div>

                            <div className="pt-4">
                                <Button onClick={handleSavePrivacy} disabled={privacyLoading || !sessionId}>
                                    {privacyLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    
                                    Salvar configurações de privacidade
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </SessionGuard>
        );
    }
