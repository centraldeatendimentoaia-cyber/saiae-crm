"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/components/dashboard/session-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Tag, Loader2, Plus, Pencil, Trash2, ChevronDown, ChevronUp, X, Search, MessageSquare, UserCheck, RefreshCw } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { SessionGuard } from "@/components/dashboard/session-guard";

export const WAP_COLORS = [
    "#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#0000FF",
    "#4B0082", "#9400D3", "#FF1493", "#00CED1", "#32CD32",
    "#FFD700", "#FF69B4", "#8B4513", "#2F4F4F", "#696969",
    "#708090", "#778899", "#B0C4DE", "#ADD8E6", "#F0E68C"
];

interface LabelData {
    id: string;
    sessionId: string;
    name: string;
    color: number;
    colorHex: string;
    _count: {
        chatLabels: number;
    };
}

interface ChatLabelEntry {
    id: string;
    chatJid: string;
    labelId: string;
    contactName?: string;
}

interface Contact {
    id: string;
    jid: string;
    name?: string;
    notify?: string;
}

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
                toast.error(data.message || "Failed to load labels");
            }
        } catch (error) {
            console.error(error);
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
        } catch (e: any) {
            toast.error(e.message || "Falha ao sincronizar");
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
                toast.error(data.message || "Failed to create label");
            }
        } catch (error) {
            console.error(error);
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
                toast.error(data.message || "Failed to update label");
            }
        } catch (error) {
            console.error(error);
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
                toast.error(data.message || "Failed to delete label");
            }
        } catch (error) {
            console.error(error);
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
            console.error(error);
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
            console.error(error);
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
                toast.error(data.message || "Failed to assign label");
            }
        } catch (error) {
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
        } catch (error) {
            toast.error("Erro ao remover a etiqueta");
        }
    };

    // --- Color Picker Component ---
    const ColorPicker = () => (
        <div className="space-y-2">
            <Label>Cor</Label>
            <div className="grid grid-cols-10 gap-1.5 mt-2">
                {WAP_COLORS.map((hex, index) => (
                    <div
                        key={index}
                        onClick={() => setCurrentColor(index)}
                        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full cursor-pointer transition-all border-2 ${currentColor === index ? 'border-foreground scale-110 ring-2 ring-foreground/20' : 'border-transparent hover:scale-105'}`}
                        style={{ backgroundColor: hex }}
                    />
                ))}
            </div>
        </div>
    );

    return (
        <SessionGuard>
            <div className="max-w-5xl space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Etiquetas de conversa</h1>
                    <p className="text-sm text-muted-foreground">Organize as conversas com etiquetas coloridas. Clique em uma etiqueta para gerenciar as conversas atribuídas.</p>
                </div>

                <Dialog open={isCreateOpen} onOpenChange={(open) => {
                    setIsCreateOpen(open);
                    if (!open) resetForm();
                }}>
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
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Criar nova etiqueta</DialogTitle>
                            <DialogDescription>Adicione uma nova etiqueta colorida para organizar as conversas.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Nome da etiqueta</Label>
                                <Input
                                    value={currentName}
                                    onChange={(e) => setCurrentName(e.target.value)}
                                    placeholder="ex.: Cliente VIP"
                                />
                            </div>
                            <ColorPicker />
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
                            <Button onClick={handleCreate} disabled={submitting || !currentName.trim()}>
                                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                                
                                Criar etiqueta
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
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
                        <Card key={label.id} className="overflow-hidden hover:shadow-md transition-shadow">
                            <div className="h-1.5 w-full" style={{ backgroundColor: label.colorHex }} />
                            <CardContent className="p-4">
                                {/* Label Header Row */}
                                <div className="flex items-center justify-between gap-2">
                                    <button
                                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                                        onClick={() => toggleLabelExpand(label.id)}
                                    >
                                        <Tag className="w-4 h-4 shrink-0" style={{ color: label.colorHex }} />
                                        <span className="font-semibold truncate">{label.name}</span>
                                        <Badge variant="secondary" className="font-normal text-xs shrink-0">
                                            {label._count.chatLabels}  conversa{label._count.chatLabels !== 1 ? "s" : ""}
                                        </Badge>
                                        {expandedLabelId === label.id
                                            ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                                            : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                                        }
                                    </button>

                                    <div className="flex gap-1 shrink-0">
                                        <Button
                                            variant="ghost" size="sm"
                                            className="h-8 px-2 text-primary hover:text-primary hover:bg-primary/10"
                                            onClick={() => {
                                                setAssignLabelId(label.id);
                                                setContactSearch("");
                                                setContacts([]);
                                                setIsAssignOpen(true);
                                            }}
                                        >
                                            <UserCheck className="w-3.5 h-3.5 mr-1" />
                                            <span className="hidden sm:inline text-xs">Atribuir</span>
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEditModal(label)}>
                                            <Pencil className="w-3.5 h-3.5" />
                                        </Button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Excluir etiqueta?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        
                                                        Isso excluirá permanentemente a etiqueta <strong>{label.name}</strong>  e a removerá de todas as conversas atribuídas.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleDelete(label.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                        
                                                        Excluir
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                </div>

                                {/* Expanded Section: Assigned Chats */}
                                {expandedLabelId === label.id && (
                                    <div className="mt-4 pt-3 border-t space-y-2">
                                        {chatLabelsLoading ? (
                                            <div className="flex items-center justify-center py-4">
                                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                                <span className="ml-2 text-sm text-muted-foreground">Carregando conversas...</span>
                                            </div>
                                        ) : chatLabels.length === 0 ? (
                                            <div className="text-center py-4">
                                                <MessageSquare className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                                                <p className="text-sm text-muted-foreground">Nenhuma conversa atribuída a esta etiqueta ainda.</p>
                                                <Button
                                                    variant="outline" size="sm" className="mt-2"
                                                    onClick={() => {
                                                        setAssignLabelId(label.id);
                                                        setContactSearch("");
                                                        setContacts([]);
                                                        setIsAssignOpen(true);
                                                    }}
                                                >
                                                    <UserCheck className="w-3.5 h-3.5 mr-1.5" />  Atribuir uma conversa
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="space-y-1.5">
                                                {chatLabels.map((cl) => (
                                                    <div
                                                        key={cl.id}
                                                        className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                                                                {(cl.contactName || cl.chatJid).charAt(0).toUpperCase()}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-medium truncate">{cl.contactName || cl.chatJid}</p>
                                                                {cl.contactName && (
                                                                    <p className="text-[11px] text-muted-foreground font-mono truncate">{cl.chatJid}</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <Button
                                                            variant="ghost" size="icon"
                                                            className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10 shrink-0"
                                                            onClick={() => removeChatFromLabel(label.id, cl.chatJid)}
                                                            title="Remover da etiqueta"
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </Button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Edit Label Modal */}
            <Dialog open={isEditOpen} onOpenChange={(open) => {
                setIsEditOpen(open);
                if (!open) resetForm();
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Editar etiqueta</DialogTitle>
                        <DialogDescription>Atualize o nome ou a cor da etiqueta.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Nome da etiqueta</Label>
                            <Input
                                value={currentName}
                                onChange={(e) => setCurrentName(e.target.value)}
                                placeholder="ex.: Cliente VIP"
                            />
                        </div>
                        <ColorPicker />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancelar</Button>
                        <Button onClick={handleEdit} disabled={submitting || !currentName.trim()}>
                            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            
                            Salvar alterações
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Assign Chat to Label Modal */}
            <Dialog open={isAssignOpen} onOpenChange={(open) => {
                setIsAssignOpen(open);
                if (!open) {
                    setAssignLabelId(null);
                    setContactSearch("");
                    setContacts([]);
                }
            }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Atribuir conversa à etiqueta</DialogTitle>
                        <DialogDescription>Busque um contato ou informe um JID para atribuir a esta etiqueta.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar contatos ou informar JID..."
                                className="pl-9"
                                value={contactSearch}
                                onChange={(e) => setContactSearch(e.target.value)}
                                autoFocus
                            />
                        </div>

                        <div className="max-h-[300px] overflow-y-auto space-y-1">
                            {contactsLoading ? (
                                <div className="flex items-center justify-center py-6">
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                </div>
                            ) : contacts.length > 0 ? (
                                contacts.map((c) => (
                                    <button
                                        key={c.id}
                                        className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left"
                                        onClick={() => {
                                            assignChatToLabel(c.jid);
                                        }}
                                    >
                                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                                            {(c.name || c.notify || c.jid).charAt(0).toUpperCase()}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium truncate">{c.name || c.notify || "Desconhecido"}</p>
                                            <p className="text-[11px] text-muted-foreground font-mono truncate">{c.jid}</p>
                                        </div>
                                        <Badge variant="outline" className="text-[10px] shrink-0">Atribuir</Badge>
                                    </button>
                                ))
                            ) : contactSearch.trim() ? (
                                <div className="text-center py-6 space-y-3">
                                    <p className="text-sm text-muted-foreground">Nenhum contato encontrado</p>
                                    {contactSearch.includes("@") && (
                                        <Button
                                            variant="outline" size="sm"
                                            onClick={() => assignChatToLabel(contactSearch.trim())}
                                        >
                                            
                                            Atribuir &quot;{contactSearch.trim()}&quot; diretamente
                                        </Button>
                                    )}
                                </div>
                            ) : (
                                <p className="text-sm text-muted-foreground text-center py-6">
                                    
                                    Digite para buscar contatos...
                                </p>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
        </SessionGuard>
    );
}
