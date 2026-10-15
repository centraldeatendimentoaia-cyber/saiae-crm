"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Trash2, Play, History, Loader2 } from "lucide-react";
import { AVAILABLE_EVENTS, type WebhookConfig, type WebhookTestResult } from "./types";

export function WebhookCard({ webhook, isTesting, testResult, onToggleActive, onToggleEvent, onEdit, onDelete, onTest, onOpenLogs }: {
    webhook: WebhookConfig;
    isTesting: boolean;
    testResult?: WebhookTestResult;
    onToggleActive: (id: string, isActive: boolean) => void;
    onToggleEvent: (webhookId: string, eventId: string) => void;
    onEdit: (webhook: WebhookConfig) => void;
    onDelete: (id: string) => void;
    onTest: (webhook: WebhookConfig) => void;
    onOpenLogs: (webhook: WebhookConfig) => void;
}) {
    return (
        <Card className={webhook.isActive ? "" : "opacity-60"}>
            <CardContent className="pt-4 space-y-3">
                {/* Header */}
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="font-semibold flex items-center gap-2">
                            {webhook.name}
                            <Badge variant={webhook.isActive ? "default" : "secondary"}>
                                {webhook.isActive ? "Ativo" : "Inativo"}
                            </Badge>
                            {webhook.sessionId && (
                                <Badge variant="outline" className="text-xs">{webhook.sessionId}</Badge>
                            )}
                        </h3>
                        <p className="text-sm text-muted-foreground font-mono">{webhook.url}</p>
                    </div>
                    <div className="flex items-center gap-1">
                        <Switch
                            checked={webhook.isActive}
                            onCheckedChange={(checked) => onToggleActive(webhook.id, checked)}
                        />
                        <Button variant="ghost" size="sm" onClick={() => onEdit(webhook)}>Editar</Button>
                        <Button variant="ghost" size="icon" onClick={() => onDelete(webhook.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                    </div>
                </div>

                {/* Event Toggles */}
                <div className="space-y-2">
                    <Label className="text-xs">Eventos (clique para alternar)</Label>
                    <div className="flex flex-wrap gap-2">
                        {AVAILABLE_EVENTS.map(event => (
                            <Badge
                                key={event.id}
                                variant={webhook.events.includes(event.id) ? "default" : "outline"}
                                className="cursor-pointer"
                                onClick={() => onToggleEvent(webhook.id, event.id)}
                            >
                                {event.label}
                            </Badge>
                        ))}
                    </div>
                </div>

                {/* Test & Logs Buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button variant="outline" size="sm" onClick={() => onTest(webhook)} disabled={isTesting}>
                        {isTesting ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                            <Play className="h-4 w-4 mr-1" />
                        )}
                        Testar
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onOpenLogs(webhook)}>
                        <History className="h-4 w-4 mr-1" />
                        Logs
                    </Button>
                </div>

                {/* Test Result */}
                {testResult && !testResult.testing && (
                    <div className={`p-3 rounded-md text-sm font-mono whitespace-pre-wrap ${
                        testResult.success
                            ? "bg-green-50 border border-green-200 text-green-800"
                            : "bg-red-50 border border-red-200 text-red-800"
                    }`}>
                        <div className="flex items-center gap-2 mb-1 font-semibold">
                            {testResult.success ? "✓ Sucesso" : "✗ Falhou"}
                            <span className="text-xs font-normal text-muted-foreground">
                                {testResult.responseTimeMs}ms
                            </span>
                        </div>
                        {testResult.statusCode && (
                            <div>Status: {testResult.statusCode}</div>
                        )}
                        {testResult.error && (
                            <div>Erro: {testResult.error}</div>
                        )}
                        {testResult.responseBody && (
                            <details className="mt-1">
                                <summary className="cursor-pointer text-xs">Corpo da resposta</summary>
                                <pre className="mt-1 text-xs overflow-x-auto">{testResult.responseBody}</pre>
                            </details>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
