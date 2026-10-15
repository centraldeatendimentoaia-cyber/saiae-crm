"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/components/dashboard/session-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { Tag, Loader2, Plus, RefreshCw } from "lucide-react";
import { DialogTrigger } from "@/components/ui/dialog";
import { SessionGuard } from "@/components/dashboard/session-guard";
import type { LabelData, ChatLabelEntry, Contact } from "./_components/types";
import { LabelFormDialog } from "./_components/label-form-dialog";
import { LabelCard } from "./_components/label-card";
import { AssignDialog } from "./_components/assign-dialog";

export default function LabelsPage() {
    const { sessionId } = useSession();
    const [labels, setLabels] = useState<LabelData[]>([]);
    const [loading, setLoading] = useState(false);

    // Form states
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);

    const [currentName, setCurrentName] = useState("");
    const [currentColor, setCurrentColor] = useState(0);
    const [currentLabelId, setCurrentLabelId] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Expanded label detail
    const [expandedLabelId, setExpandedLabelId] = useState<string | null>(null);
    const [chatLabels, setChatLabels] = useState<ChatLabelEntry[]>([]);
    const [chatLabelsLoading, setChatLabelsLoading] = useState(false);

    // Assign chat dialog
    const [isAssignOpen, setIsAssignOpen] = useState(false);
    const [assignLabelId, setAssignLabelId] = useState<string | null>(null);
    const [contactSearch, setContactSearch] = useState("");
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [contactsLoading, setContactsLoading] = useState(false);

    useEffect(() => {
        if (sessionId) {
            fetchLabels();
        }
    }, [sessionId]);

    const fetchLabels = async () => {
        if (!sessionId) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/labels/${sessionId}`);
            const data = await res.json();

            if (res.ok && data.data?.labels) {
                setLabels(data.data.labels);
            } else {
                toast.error(data.message || "Falha ao carregar as etiquetas");
            }
        } catch (error) {
            logger.error("Etiquetas", "Falha ao carregar as etiquetas", error);
            toast.error("Erro ao carregar as etiquetas");
        } finally {
            setLoading(false);
        }
    };

    const [syncing, setSyncing] = useState(false);

    const handleSync = async () => {
        if (!sessionId) return;
        setSyncing(true);
        try {
            const res = await fetch(`/api/labels/${sessionId}/sync`, { method: "POST" });
            const data = await res.json();
            if (!res.ok || !data.status) throw new Error(data.error || "Falha ao sincronizar");
            const { labels: total, associations, isBusiness, syncError } = data.data;
            await fetchLabels();
            if (total > 0) {
                toast.success(`${total} etiquetas sincronizadas (${associations} conversas etiquetadas)`);
            } else if (isBusiness === false) {
                toast.error("Este número não é WhatsApp Business. Etiquetas só existem no WhatsApp Business.");
            } else if (syncError) {
                toast.error("O WhatsApp não liberou as etiquetas: " + syncError);
            } else {
                toast.warning("Nenhuma etiqueta recebida. Se você tem etiquetas no celular, reconecte a sessão (novo QR) para a sincronização completa.");
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao sincronizar");
        } finally {
            setSyncing(false);
        }
    };

    const handleCreate = async () => {
        if (!sessionId) return;
        if (!currentName.trim()) {
            toast.error("O nome da etiqueta é obrigatório");
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch(`/api/labels/${sessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: currentName.trim(), color: currentColor })
            });
            const data = await res.json();

            if (res.ok) {
                toast.success("Etiqueta criada com sucesso");
                setIsCreateOpen(false);
                resetForm();
                fetchLabels();
            } else {
                toast.error(data.message || "Falha ao criar a etiqueta");
            }
        } catch (error) {
            logger.error("Etiquetas", "Falha ao criar a etiqueta", error);
            toast.error("Erro ao criar a etiqueta");
        } finally {
            setSubmitting(false);
        }
    };

    const handleEdit = async () => {
        if (!sessionId || !currentLabelId) return;
        if (!currentName.trim()) {
            toast.error("O nome da etiqueta é obrigatório");
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch(`/api/labels/${sessionId}/${currentLabelId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: currentName.trim(), color: currentColor })
            });
            const data = await res.json();

            if (res.ok) {
                toast.success("Etiqueta atualizada com sucesso");
                setIsEditOpen(false);
                resetForm();
                fetchLabels();
            } else {
                toast.error(data.message || "Falha ao atualizar a etiqueta");
            }
        } catch (error) {
            logger.error("Etiquetas", "Falha ao atualizar a etiqueta", error);
            toast.error("Erro ao atualizar a etiqueta");
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (labelId: string) => {
        if (!sessionId) return;
        try {
            const res = await fetch(`/api/labels/${sessionId}/${labelId}`, {
                method: "DELETE"
            });
            const data = await res.json();

            if (res.ok) {
                toast.success("Etiqueta excluída com sucesso");
                if (expandedLabelId === labelId) {
                    setExpandedLabelId(null);
                }
                fetchLabels();
            } else {
                toast.error(data.message || "Falha ao excluir a etiqueta");
            }
        } catch (error) {
            logger.error("Etiquetas", "Falha ao excluir a etiqueta", error);
            toast.error("Erro ao excluir a etiqueta");
        }
    };

    const resetForm = () => {
        setCurrentName("");
        setCurrentColor(0);
        setCurrentLabelId(null);
    };

    const openEditModal = (label: LabelData) => {
        setCurrentLabelId(label.id);
        setCurrentName(label.name);
        setCurrentColor(label.color);
        setIsEditOpen(true);
    };

    const openAssign = (labelId: string) => {
        setAssignLabelId(labelId);
        setContactSearch("");
        setContacts([]);
        setIsAssignOpen(true);
    };

    // --- Chat Label Management ---
    const toggleLabelExpand = async (labelId: string) => {
        if (expandedLabelId === labelId) {
            setExpandedLabelId(null);
            return;
        }
        setExpandedLabelId(labelId);
        await fetchChatLabels(labelId);
    };

    const fetchChatLabels = async (labelId: string) => {
        if (!sessionId) return;
        setChatLabelsLoading(true);
        try {
            const res = await fetch(`/api/labels/${sessionId}/chats?labelId=${labelId}`);
            const data = await res.json();
            if (res.ok) {
                setChatLabels(data.data || []);
            } else {
                setChatLabels([]);
            }
        } catch (error) {
            logger.error("Etiquetas", "Falha ao carregar as conversas da etiqueta", error);
            setChatLabels([]);
        } finally {
            setChatLabelsLoading(false);
        }
    };

    const searchContacts = useCallback(async (query: string) => {
        if (!sessionId || !query.trim()) {
            setContacts([]);
            return;
        }
        setContactsLoading(true);
        try {
            const res = await fetch(`/api/contacts/${sessionId}?search=${encodeURIComponent(query)}&limit=20`);
            const data = await res.json();
            if (res.ok) {
                setContacts(data.data || []);
            }
        } catch (error) {
            logger.error("Etiquetas", "Falha ao buscar contatos", error);
        } finally {
            setContactsLoading(false);
        }
    }, [sessionId]);

    useEffect(() => {
        const timer = setTimeout(() => {
            searchContacts(contactSearch);
        }, 300);
        return () => clearTimeout(timer);
    }, [contactSearch, searchContacts]);

    const assignChatToLabel = async (jid: string) => {
        if (!sessionId || !assignLabelId) return;
        try {
            const res = await fetch(`/api/labels/${sessionId}/chat/${encodeURIComponent(jid)}/labels`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ labelIds: [assignLabelId], action: "add" })
            });

            if (res.ok) {
                toast.success("Conversa atribuída à etiqueta");
                fetchLabels();
                if (expandedLabelId === assignLabelId) {
                    fetchChatLabels(assignLabelId);
                }
            } else {
                const data = await res.json();
                toast.error(data.message || "Falha ao atribuir a etiqueta");
            }
        } catch {
            toast.error("Erro ao atribuir a etiqueta");
        }
    };

    const removeChatFromLabel = async (labelId: string, jid: string) => {
        if (!sessionId) return;
        try {
            const res = await fetch(`/api/labels/${sessionId}/chat/${encodeURIComponent(jid)}/labels`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ labelIds: [labelId], action: "remove" })
            });

            if (res.ok) {
                toast.success("Conversa removida da etiqueta");
                fetchLabels();
                if (expandedLabelId === labelId) {
                    fetchChatLabels(labelId);
                }
            } else {
                toast.error("Falha ao remover a etiqueta");
            }
        } catch {
            toast.error("Erro ao remover a etiqueta");
        }
    };

    return (
        <SessionGuard>
            <div className="max-w-5xl space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Etiquetas de conversa</h1>
                    <p className="text-sm text-muted-foreground">Organize as conversas com etiquetas coloridas. Clique em uma etiqueta para gerenciar as conversas atribuídas.</p>
                </div>

                <LabelFormDialog
                    open={isCreateOpen}
                    onOpenChange={(open) => {
                        setIsCreateOpen(open);
                        if (!open) resetForm();
                    }}
                    title="Criar nova etiqueta"
                    description="Adicione uma nova etiqueta colorida para organizar as conversas."
                    submitLabel="Criar etiqueta"
                    name={currentName}
                    onNameChange={setCurrentName}
                    color={currentColor}
                    onColorChange={setCurrentColor}
                    submitting={submitting}
                    onSubmit={handleCreate}
                    trigger={
                        <>
                            <Button variant="outline" onClick={handleSync} disabled={syncing || !sessionId}>
                                <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
                                {syncing ? "Sincronizando..." : "Sincronizar do WhatsApp"}
                            </Button>
                            <DialogTrigger asChild>
                                <Button>
                                    <Plus className="w-4 h-4 mr-2" />
                                    Nova etiqueta
                                </Button>
                            </DialogTrigger>
                        </>
                    }
                />
            </div>

            {loading ? (
                <div className="flex items-center justify-center p-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : labels.length === 0 ? (
                <Card className="border-dashed shadow-none bg-muted/30">
                    <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                        <Tag className="w-12 h-12 text-muted-foreground/50 mb-4" />
                        <h3 className="text-lg font-semibold">Nenhuma etiqueta encontrada</h3>
                        <p className="text-muted-foreground mb-4">Você ainda não criou nenhuma etiqueta de conversa.</p>
                        <Button variant="outline" onClick={() => setIsCreateOpen(true)}>Crie sua primeira etiqueta</Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {labels.map((label) => (
                        <LabelCard
                            key={label.id}
                            label={label}
                            expanded={expandedLabelId === label.id}
                            chatLabels={chatLabels}
                            chatLabelsLoading={chatLabelsLoading}
                            onToggleExpand={toggleLabelExpand}
                            onAssign={openAssign}
                            onEdit={openEditModal}
                            onDelete={handleDelete}
                            onRemoveChat={removeChatFromLabel}
                        />
                    ))}
                </div>
            )}

            {/* Edit Label Modal */}
            <LabelFormDialog
                open={isEditOpen}
                onOpenChange={(open) => {
                    setIsEditOpen(open);
                    if (!open) resetForm();
                }}
                title="Editar etiqueta"
                description="Atualize o nome ou a cor da etiqueta."
                submitLabel="Salvar alterações"
                name={currentName}
                onNameChange={setCurrentName}
                color={currentColor}
                onColorChange={setCurrentColor}
                submitting={submitting}
                onSubmit={handleEdit}
            />

            {/* Assign Chat to Label Modal */}
            <AssignDialog
                open={isAssignOpen}
                onOpenChange={(open) => {
                    setIsAssignOpen(open);
                    if (!open) {
                        setAssignLabelId(null);
                        setContactSearch("");
                        setContacts([]);
                    }
                }}
                search={contactSearch}
                onSearchChange={setContactSearch}
                contacts={contacts}
                loading={contactsLoading}
                onAssign={assignChatToLabel}
            />
        </div>
        </SessionGuard>
    );
}
