"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Webhook } from "lucide-react";
import { toast } from "sonner";
import { logger } from "@/lib/logger";

import { SessionGuard } from "@/components/dashboard/session-guard";
import WebhookLogDialog from "@/components/dashboard/webhook-log-dialog";
import { useSession } from "@/components/dashboard/session-provider";
import { DEFAULT_NEW_EVENTS, type WebhookConfig, type WebhookTestResult } from "./_components/types";
import { ApiKeyCard } from "./_components/api-key-card";
import { EventSwitchGrid } from "./_components/event-switch-grid";
import { WebhookCard } from "./_components/webhook-card";
import { EditWebhookDialog, DeleteWebhookDialog } from "./_components/dialogs";

export default function WebhooksPage() {
    const { sessionId, sessions } = useSession();
    const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
    const [loading, setLoading] = useState(true);

    // New webhook form
    const [showNewForm, setShowNewForm] = useState(false);
    const [newName, setNewName] = useState("");
    const [newUrl, setNewUrl] = useState("");
    const [newSecret, setNewSecret] = useState("");
    const [newEvents, setNewEvents] = useState<string[]>(DEFAULT_NEW_EVENTS);

    // Testing state
    const [testingId, setTestingId] = useState<string | null>(null);
    const [testResults, setTestResults] = useState<Record<string, WebhookTestResult>>({});

    // Log viewer state
    const [logDialogId, setLogDialogId] = useState<string | null>(null);
    const [logDialogName, setLogDialogName] = useState("");
    const [logDialogSessionId, setLogDialogSessionId] = useState("");

    useEffect(() => {
        if (sessions.length > 0) {
            fetchWebhooks();
        }
    }, [sessionId, sessions]);

    const fetchWebhooks = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/webhooks/${sessionId}`);
            if (res.ok) {
                const responseData = await res.json();
                const data = responseData?.data || [];
                const currentSession = sessions.find(s => s.sessionId === sessionId);
                const currentSessionCuid = currentSession?.id;

                const filtered = data.filter((w: WebhookConfig) =>
                    w.sessionId === sessionId ||
                    w.sessionId === currentSessionCuid ||
                    !w.sessionId
                );
                setWebhooks(filtered);
            }
        } catch (error) {
            logger.error("Webhooks", "Falha ao carregar os webhooks", error);
        } finally {
            setLoading(false);
        }
    };

    const handleTestWebhook = async (webhook: WebhookConfig) => {
        setTestingId(webhook.id);
        setTestResults(prev => ({ ...prev, [webhook.id]: { testing: true } }));
        try {
            const targetSessionId = webhook.sessionId || sessionId;
            const res = await fetch(`/api/webhooks/${targetSessionId}/${webhook.id}/test`, { method: "POST" });
            const data = await res.json();
            setTestResults(prev => ({ ...prev, [webhook.id]: data?.data || { success: false, error: "Sem resposta" } }));
            if (data?.data?.success) {
                toast.success("Teste do webhook realizado com sucesso!");
            } else {
                toast.error(`Falha no teste do webhook: ${data?.data?.error || "Erro desconhecido"}`);
            }
        } catch (error) {
            setTestResults(prev => ({ ...prev, [webhook.id]: { success: false, error: error instanceof Error ? error.message : String(error) } }));
            toast.error("Falha ao testar o webhook");
        } finally {
            setTestingId(null);
        }
    };

    const openLogDialog = (webhook: WebhookConfig) => {
        const targetSessionId = webhook.sessionId || sessionId || "";
        setLogDialogId(webhook.id);
        setLogDialogName(webhook.name);
        setLogDialogSessionId(targetSessionId);
    };

    const closeLogDialog = () => {
        setLogDialogId(null);
        setLogDialogName("");
        setLogDialogSessionId("");
    };

    // Edit state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [editValues, setEditValues] = useState({ name: "", url: "", secret: "", events: [] as string[] });

    const handleEdit = (webhook: WebhookConfig) => {
        setEditingId(webhook.id);
        setEditValues({ name: webhook.name, url: webhook.url, secret: webhook.secret || "", events: webhook.events });
        setIsEditOpen(true);
    };

    const handleSaveWebhook = async () => {
        if (!newName || !newUrl || newEvents.length === 0) {
            toast.error("Nome, URL e pelo menos um evento são obrigatórios");
            return;
        }
        if (!sessionId) {
            toast.error("Nenhuma sessão ativa selecionada");
            return;
        }
        try {
            const payload: Record<string, unknown> = { name: newName, url: newUrl, events: newEvents };
            if (newSecret) payload.secret = newSecret;
            const res = await fetch(`/api/webhooks/${sessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                toast.success("Webhook criado!");
                setShowNewForm(false);
                setNewName("");
                setNewUrl("");
                setNewSecret("");
                setNewEvents(DEFAULT_NEW_EVENTS);
                fetchWebhooks();
            } else {
                toast.error("Falha ao criar o webhook");
            }
        } catch {
            toast.error("Ocorreu um erro");
        }
    };

    const handleUpdateWebhook = async () => {
        const { name, url, secret, events } = editValues;
        if (!name || !url || events.length === 0) {
            toast.error("Nome, URL e pelo menos um evento são obrigatórios");
            return;
        }
        if (!sessionId || !editingId) return;
        try {
            const webhook = webhooks.find(w => w.id === editingId);
            const targetSessionId = webhook?.sessionId || sessionId;
            const payload: Record<string, unknown> = { name, url, events };
            if (secret) payload.secret = secret;
            const res = await fetch(`/api/webhooks/${targetSessionId}/${editingId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                toast.success("Webhook atualizado!");
                setIsEditOpen(false);
                setEditingId(null);
                fetchWebhooks();
            } else {
                toast.error("Falha ao atualizar o webhook");
            }
        } catch {
            toast.error("Ocorreu um erro");
        }
    };

    const toggleWebhookActive = async (id: string, isActive: boolean) => {
        try {
            const webhook = webhooks.find(w => w.id === id);
            const targetSessionId = webhook?.sessionId || sessionId;
            await fetch(`/api/webhooks/${targetSessionId}/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isActive })
            });
            setWebhooks(webhooks.map(w => w.id === id ? { ...w, isActive } : w));
        } catch {
            toast.error("Falha ao atualizar o webhook");
        }
    };

    const toggleEventForWebhook = async (webhookId: string, eventId: string) => {
        const webhook = webhooks.find(w => w.id === webhookId);
        if (!webhook) return;
        const events = webhook.events.includes(eventId)
            ? webhook.events.filter(e => e !== eventId)
            : [...webhook.events, eventId];
        const targetSessionId = webhook.sessionId || sessionId;
        try {
            await fetch(`/api/webhooks/${targetSessionId}/${webhookId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ events })
            });
            setWebhooks(webhooks.map(w => w.id === webhookId ? { ...w, events } : w));
        } catch {
            toast.error("Falha ao atualizar os eventos do webhook");
        }
    };

    const [deleteId, setDeleteId] = useState<string | null>(null);

    const confirmDelete = async () => {
        if (!deleteId) return;
        try {
            const webhook = webhooks.find(w => w.id === deleteId);
            const targetSessionId = webhook?.sessionId || sessionId;
            await fetch(`/api/webhooks/${targetSessionId}/${deleteId}`, { method: "DELETE" });
            setWebhooks(webhooks.filter(w => w.id !== deleteId));
            toast.success("Webhook excluído");
        } catch {
            toast.error("Falha ao excluir o webhook");
        } finally {
            setDeleteId(null);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-xl sm:text-2xl font-bold">Webhooks e API</h1>
            </div>

            <ApiKeyCard />

            {/* Webhooks Section */}
            <SessionGuard>
                <Card>
                    <CardHeader>
                        <div className="flex justify-between items-center">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <Webhook className="h-5 w-5" /> Webhooks
                                </CardTitle>
                                <CardDescription>
                                    Envie eventos em tempo real para URLs externas quando algo acontecer no WhatsApp.
                                </CardDescription>
                            </div>
                            <Button onClick={() => {
                                setNewName("");
                                setNewUrl("");
                                setNewSecret("");
                                setNewEvents(DEFAULT_NEW_EVENTS);
                                setShowNewForm(!showNewForm);
                            }}>
                                <Plus className="h-4 w-4 mr-2" />  Adicionar webhook
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {showNewForm && (
                            <Card className="border-dashed border-2">
                                <CardHeader><CardTitle>Novo webhook</CardTitle></CardHeader>
                                <CardContent className="pt-4 space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>Nome</Label>
                                            <Input placeholder="Meu servidor" value={newName} onChange={(e) => setNewName(e.target.value)} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>URL do webhook</Label>
                                            <Input placeholder="https://exemplo.com/webhook" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Segredo (opcional, para assinatura HMAC)</Label>
                                        <Input placeholder="sua-chave-secreta" value={newSecret} onChange={(e) => setNewSecret(e.target.value)} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Eventos</Label>
                                        <EventSwitchGrid className="grid grid-cols-2 gap-2" events={newEvents} onChange={setNewEvents} />
                                    </div>
                                    <div className="flex gap-2 justify-end">
                                        <Button variant="ghost" onClick={() => setShowNewForm(false)}>Cancelar</Button>
                                        <Button onClick={handleSaveWebhook}>Criar webhook</Button>
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {loading ? (
                            <p className="text-center text-muted-foreground py-8">Carregando...</p>
                        ) : webhooks.length === 0 ? (
                            <p className="text-center text-muted-foreground py-8">
                                Nenhum webhook configurado para esta sessão. Clique em "Adicionar webhook" para criar um.
                            </p>
                        ) : (
                            webhooks.map((webhook) => (
                                <WebhookCard
                                    key={webhook.id}
                                    webhook={webhook}
                                    isTesting={testingId === webhook.id}
                                    testResult={testResults[webhook.id]}
                                    onToggleActive={toggleWebhookActive}
                                    onToggleEvent={toggleEventForWebhook}
                                    onEdit={handleEdit}
                                    onDelete={setDeleteId}
                                    onTest={handleTestWebhook}
                                    onOpenLogs={openLogDialog}
                                />
                            ))
                        )}
                    </CardContent>
                </Card>
            </SessionGuard>

            <EditWebhookDialog
                open={isEditOpen}
                onOpenChange={setIsEditOpen}
                values={editValues}
                onChange={setEditValues}
                onSave={handleUpdateWebhook}
            />

            <DeleteWebhookDialog open={!!deleteId} onCancel={() => setDeleteId(null)} onConfirm={confirmDelete} />

            {/* Webhook Log Dialog */}
            {logDialogId && (
                <WebhookLogDialog
                    webhookId={logDialogId}
                    webhookName={logDialogName}
                    targetSessionId={logDialogSessionId}
                    open={!!logDialogId}
                    onClose={closeLogDialog}
                />
            )}
        </div>
    );
}
