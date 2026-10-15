"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { AlertCircle } from "lucide-react";
import { SaveButton } from "./save-button";
import type { BotConfig, SectionProps } from "./types";

type SafeKey = "safeDelayMin" | "safeDelayMax" | "safeBatchSize" | "safeBatchPause" | "safeStartHour" | "safeEndHour";

const SAFE_FIELDS: { key: SafeKey; label: string; min: number; max: number; unit: string }[] = [
    { key: "safeDelayMin", label: "Intervalo mínimo entre mensagens", min: 1, max: 600, unit: "segundos" },
    { key: "safeDelayMax", label: "Intervalo máximo entre mensagens", min: 1, max: 1800, unit: "segundos" },
    { key: "safeBatchSize", label: "Pausa a cada (0 = sem pausa)", min: 0, max: 1000, unit: "envios" },
    { key: "safeBatchPause", label: "Duração da pausa", min: 1, max: 120, unit: "minutos" },
    { key: "safeStartHour", label: "Enviar a partir das", min: 0, max: 23, unit: "h" },
    { key: "safeEndHour", label: "Parar de enviar às", min: 1, max: 24, unit: "h" },
];

type SpamKey = "spamLimit" | "spamInterval" | "spamDelayMin" | "spamDelayMax";

function SpamField({ config, update, field, label, fallback, min, step, children }: SectionProps & {
    field: SpamKey;
    label: string;
    fallback: number;
    min: number;
    step?: number;
    children: React.ReactNode;
}) {
    return (
        <div className="grid gap-2">
            <Label className="font-semibold">{label}</Label>
            <Input
                type="number"
                value={config[field]}
                onChange={e => update({ [field]: parseInt(e.target.value) || fallback } as Partial<BotConfig>)}
                min={min}
                step={step}
            />
            <p className="text-xs text-muted-foreground">{children}</p>
        </div>
    );
}

export function AntiBanSection({ config, update, saving, disabled, onSave }: SectionProps & {
    saving: boolean;
    disabled: boolean;
    onSave: () => void;
}) {
    return (
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
                    <Switch id="anti-spam" checked={config.antiSpamEnabled}
                        onCheckedChange={c => update({ antiSpamEnabled: c })} />
                </div>

                <div className="flex items-center justify-between space-x-2 border p-3 rounded-lg bg-emerald-500/5 border-emerald-500/20">
                    <Label htmlFor="only-interacted" className="flex flex-col space-y-1">
                        <span className="font-semibold">Enviar só para quem já interagiu</span>
                        <span className="font-normal text-xs text-muted-foreground">
                            Disparos e agendamentos só vão para contatos que já mandaram mensagem para este número. É o público mais seguro: quem já conversa com você quase nunca denuncia. Quem nunca falou com você é pulado e aparece como "Sem conversa anterior". Vale a partir de agora: quem só estava na agenda do celular, sem nunca ter escrito, fica de fora.
                        </span>
                    </Label>
                    <Switch id="only-interacted" checked={!!config.onlyInteracted}
                        onCheckedChange={c => update({ onlyInteracted: c })} />
                </div>

                {config.antiSpamEnabled && (
                    <div className="grid gap-6 animate-in fade-in slide-in-from-top-1 duration-200">
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
                            <p className="text-sm font-semibold">🛡️ Modo Seguro dos disparos</p>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                Vale para disparos e mensagens agendadas. Ajuste ao seu gosto: quanto mais rápido e mais mensagens, maior o risco de o WhatsApp bloquear o número. Não há limite diário.
                            </p>
                            <div className="grid gap-3 sm:grid-cols-2">
                                {SAFE_FIELDS.map(f => (
                                    <div key={f.key} className="space-y-1">
                                        <Label className="text-xs">{f.label}</Label>
                                        <div className="flex items-center gap-2">
                                            <Input type="number" min={f.min} max={f.max} value={config[f.key]}
                                                onChange={e => update({ [f.key]: parseInt(e.target.value) || 0 } as Partial<BotConfig>)} />
                                            <span className="text-xs text-muted-foreground">{f.unit}</span>
                                        </div>
                                    </div>
                                ))}
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
                                <strong>Exemplo:</strong>  Com limite = <strong>{config.spamLimit}</strong>  e janela = <strong>{config.spamInterval}s</strong>  → as primeiras {config.spamLimit}  mensagens em {config.spamInterval}  segundos são enviadas na hora. A mensagem nº{config.spamLimit + 1}  e seguintes serão atrasadas em {config.spamDelayMin}ms–{config.spamDelayMax}ms cada.
                            </p>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4">
                            <SpamField config={config} update={update} field="spamLimit" label="Limite de mensagens" fallback={1} min={1}>
                                Número de mensagens permitidas em velocidade total antes de o atraso começar.
                                <span className="text-orange-600 dark:text-orange-400">  Menor = mais seguro, porém mais lento.</span>
                            </SpamField>
                            <SpamField config={config} update={update} field="spamInterval" label="Janela de tempo (segundos)" fallback={1} min={1}>
                                A janela móvel usada para contar mensagens. Passado esse tempo, o contador reinicia naturalmente.
                                <span className="text-orange-600 dark:text-orange-400">  Maior = mais conservador.</span>
                            </SpamField>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4">
                            <SpamField config={config} update={update} field="spamDelayMin" label="Atraso mínimo (ms)" fallback={0} min={0} step={100}>
                                Atraso aleatório mínimo aplicado. 1000 ms = 1 segundo.
                            </SpamField>
                            <SpamField config={config} update={update} field="spamDelayMax" label="Atraso máximo (ms)" fallback={0} min={0} step={100}>
                                Atraso aleatório máximo aplicado. 3000 ms = 3 segundos.
                            </SpamField>
                        </div>

                        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                            <p className="text-xs text-muted-foreground">
                                ⚠️ <strong>Configuração segura recomendada:</strong>  Limite <strong>5</strong>, Janela <strong>10s</strong>, Atraso <strong>1000–3000 ms</strong>. Para disparos de grande volume, use Limite <strong>3</strong>  com Atraso <strong>2000–5000 ms</strong>.
                            </p>
                        </div>
                    </div>
                )}

                <div className="pt-2">
                    <SaveButton onClick={onSave} loading={saving} disabled={disabled}>
                        Salvar configurações de proteção
                    </SaveButton>
                </div>
            </CardContent>
        </Card>
    );
}
