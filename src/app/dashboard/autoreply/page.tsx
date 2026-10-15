"use client";

import { errorMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { EmojiTextarea } from "@/components/emoji-textarea";

import { useState, useEffect } from "react";
import { useSession } from "@/components/dashboard/session-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { BotMessageSquare, Loader2, Plus, Trash2, MessageCircleReply, Image as ImageIcon, Pencil } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAutoReplies, createAutoReply, deleteAutoReply, updateAutoReply } from "./actions";
import { SessionGuard } from "@/components/dashboard/session-guard";

interface AutoReply {
    id: string;
    keyword: string;
    matchType: string;
    response: string;
    isMedia: boolean;
    mediaUrl: string | null;
    mediaType: string | null;
    triggerType: string;
    createdAt: Date;
}

export default function AutoReplyPage() {
    const { sessionId } = useSession();
    const [rules, setRules] = useState<AutoReply[]>([]);
    const [loading, setLoading] = useState(false);
    
    // Form states
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    
    const [keyword, setKeyword] = useState("");
    const [response, setResponse] = useState("");
    const [matchType, setMatchType] = useState("EXACT");
    const [triggerType, setTriggerType] = useState("ALL");
    const [mediaUrl, setMediaUrl] = useState("");
    const [mediaType, setMediaType] = useState("image");

    // Edit states
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [editKeyword, setEditKeyword] = useState("");
    const [editResponse, setEditResponse] = useState("");
    const [editMatchType, setEditMatchType] = useState("EXACT");
    const [editTriggerType, setEditTriggerType] = useState("ALL");
    const [editMediaUrl, setEditMediaUrl] = useState("");
    const [editMediaType, setEditMediaType] = useState("image");

    useEffect(() => {
        if (sessionId) {
            fetchRules();
        }
    }, [sessionId]);

    const fetchRules = async () => {
        if (!sessionId) return;
        setLoading(true);
        try {
            // Using direct Server Action instead of API route
            const data = await getAutoReplies(sessionId);
            setRules(data as unknown as AutoReply[]);
        } catch (error) {
            logger.error("Autoreply", "Erro", error);
            toast.error(errorMessage(error, "Erro ao carregar as respostas automáticas"));
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!sessionId) return;
        if (!keyword.trim() || (!response.trim() && !mediaUrl.trim())) {
            toast.error("Palavra-chave e resposta (ou URL de mídia) são obrigatórias");
            return;
        }

        setSubmitting(true);
        try {
            // Using direct Server Action instead of API route
            await createAutoReply(sessionId, {
                keyword: keyword.trim(),
                response: response.trim(),
                matchType,
                triggerType,
                isMedia: !!mediaUrl.trim(),
                mediaUrl: mediaUrl.trim() || null,
                mediaType: mediaType || null
            });

            toast.success("Regra de resposta automática criada");
            setIsCreateOpen(false);
            fetchRules();
            resetForm();
        } catch (error) {
            logger.error("Autoreply", "Erro", error);
            toast.error(errorMessage(error, "Erro ao criar a resposta automática"));
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (ruleId: string) => {
        if (!sessionId) return;
        try {
            // Using direct Server Action
            await deleteAutoReply(sessionId, ruleId);
            toast.success("Resposta automática excluída");
            fetchRules();
        } catch (error) {
            logger.error("Autoreply", "Erro", error);
            toast.error(errorMessage(error, "Erro ao excluir a resposta automática"));
        }
    };

    const resetForm = () => {
        setKeyword("");
        setResponse("");
        setMatchType("EXACT");
        setTriggerType("ALL");
        setMediaUrl("");
        setMediaType("image");
    };

    const handleEdit = (rule: AutoReply) => {
        setEditId(rule.id);
        setEditKeyword(rule.keyword);
        setEditResponse(rule.response || "");
        setEditMatchType(rule.matchType);
        setEditTriggerType(rule.triggerType);
        setEditMediaUrl(rule.mediaUrl || "");
        setEditMediaType(rule.mediaType || "image");
        setIsEditOpen(true);
    };

    const handleUpdate = async () => {
        if (!sessionId || !editId) return;
        if (!editKeyword.trim() || (!editResponse.trim() && !editMediaUrl.trim())) {
            toast.error("Palavra-chave e resposta (ou URL de mídia) são obrigatórias");
            return;
        }

        setSubmitting(true);
        try {
            await updateAutoReply(sessionId, editId, {
                keyword: editKeyword.trim(),
                response: editResponse.trim(),
                matchType: editMatchType,
                triggerType: editTriggerType,
                isMedia: !!editMediaUrl.trim(),
                mediaUrl: editMediaUrl.trim() || null,
                mediaType: editMediaType || null
            });

            toast.success("Regra de resposta automática atualizada");
            setIsEditOpen(false);
            fetchRules();
        } catch (error) {
            logger.error("Autoreply", "Erro", error);
            toast.error(errorMessage(error, "Erro ao atualizar a resposta automática"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <SessionGuard>
            <div className="max-w-5xl space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Respostas Automáticas</h1>
                    <p className="text-muted-foreground">Configure regras para responder automaticamente às mensagens recebidas.</p>
                </div>

                <Dialog open={isCreateOpen} onOpenChange={(open) => {
                    setIsCreateOpen(open);
                    if (!open) resetForm();
                }}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="w-4 h-4 mr-2" />
                            
                            Nova regra
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[500px]">
                        <DialogHeader>
                            <DialogTitle>Criar regra de resposta automática</DialogTitle>
                            <DialogDescription>Adicione uma nova resposta baseada em palavra-chave.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Palavra-chave</Label>
                                    <Input 
                                        value={keyword} 
                                        onChange={(e) => setKeyword(e.target.value)} 
                                        placeholder="ex.: !ajuda, ping" 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Tipo de correspondência</Label>
                                    <Select value={matchType} onValueChange={setMatchType}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="EXACT">Correspondência exata</SelectItem>
                                            <SelectItem value="CONTAINS">Contém</SelectItem>
                                            <SelectItem value="STARTS_WITH">Começa com</SelectItem>
                                            <SelectItem value="REGEX">Expressão regular</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Selecione o público do gatilho</Label>
                                <Select value={triggerType} onValueChange={setTriggerType}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">Todos e grupos</SelectItem>
                                        <SelectItem value="PRIVATE">Somente conversas privadas</SelectItem>
                                        <SelectItem value="GROUP">Somente grupos</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>Mensagem de resposta (opcional)</Label>
                                <EmojiTextarea
                                    value={response}
                                    onValueChange={setResponse}
                                    placeholder="Obrigado pela sua mensagem! Nossa equipe retornará em breve." 
                                    className="min-h-[120px]"
                                />
                                <p className="text-xs text-muted-foreground">Você pode usar a formatação padrão do WhatsApp (*negrito*, _itálico_, ~riscado~)</p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>URL da mídia (opcional)</Label>
                                    <Input 
                                        value={mediaUrl} 
                                        onChange={(e) => setMediaUrl(e.target.value)} 
                                        placeholder="https://exemplo.com/imagem.jpg" 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Tipo de mídia</Label>
                                    <Select value={mediaType} onValueChange={setMediaType}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="image">Imagem</SelectItem>
                                            <SelectItem value="video">Vídeo</SelectItem>
                                            <SelectItem value="document">Documento</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
                            <Button onClick={handleCreate} disabled={submitting || !keyword.trim() || (!response.trim() && !mediaUrl.trim())}>
                                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Salvar regra"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {loading ? (
                <div className="flex items-center justify-center p-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : rules.length === 0 ? (
                <Card className="border-dashed shadow-none bg-muted/30">
                    <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                        <BotMessageSquare className="w-12 h-12 text-muted-foreground/50 mb-4" />
                        <h3 className="text-lg font-semibold">Nenhuma resposta automática configurada</h3>
                        <p className="text-muted-foreground mb-4">Você ainda não configurou nenhuma resposta automática.</p>
                        <Button variant="outline" onClick={() => setIsCreateOpen(true)}>Crie sua primeira regra</Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {rules.map((rule) => (
                        <Card key={rule.id} className="flex flex-col h-full hover:shadow-md transition-shadow">
                            <CardHeader className="pb-3 border-b">
                                <div className="flex justify-between items-start">
                                    <div className="space-y-1 pr-2">
                                        <CardTitle className="text-lg flex items-center gap-2">
                                            <span className="font-mono bg-muted px-2 py-0.5 rounded text-sm break-all">{rule.keyword}</span>
                                        </CardTitle>
                                        <div className="flex gap-2 flex-wrap text-xs">
                                            <Badge variant="outline" className="text-muted-foreground font-normal shrink-0">{rule.matchType}</Badge>
                                            <Badge variant="secondary" className="font-normal shrink-0 text-[10px]">{rule.triggerType}</Badge>
                                        </div>
                                    </div>
                                    <div className="shrink-0 flex gap-1">
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-muted" onClick={() => handleEdit(rule)}>
                                            <Pencil className="w-4 h-4" />
                                        </Button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10">
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Excluir regra?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        
                                                        Tem certeza de que deseja excluir a resposta automática da palavra-chave <strong>{rule.keyword}</strong>? Esta ação não pode ser desfeita.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleDelete(rule.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                        
                                                        Excluir
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-4 flex-grow flex flex-col">
                                <div className="text-sm text-foreground bg-muted/30 p-3 rounded-md border whitespace-pre-wrap flex-grow">
                                    {rule.response}
                                </div>
                                {rule.isMedia && (
                                    <div className="mt-3 text-xs flex items-center gap-1 text-zinc-600 bg-zinc-50 px-2 py-1 rounded w-fit">
                                        <ImageIcon className="w-3 h-3" />  Inclui anexo de mídia
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Edit Auto-Reply Dialog Modal */}
            <Dialog open={isEditOpen} onOpenChange={(open) => {
                setIsEditOpen(open);
                if (!open) setEditId(null);
            }}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>Editar regra de resposta automática</DialogTitle>
                        <DialogDescription>Modifique a regra de resposta por palavra-chave.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Palavra-chave</Label>
                                <Input 
                                    value={editKeyword} 
                                    onChange={(e) => setEditKeyword(e.target.value)} 
                                    placeholder="ex.: !ajuda, ping" 
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Tipo de correspondência</Label>
                                <Select value={editMatchType} onValueChange={setEditMatchType}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="EXACT">Correspondência exata</SelectItem>
                                        <SelectItem value="CONTAINS">Contém</SelectItem>
                                        <SelectItem value="STARTS_WITH">Começa com</SelectItem>
                                        <SelectItem value="REGEX">Expressão regular</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Selecione o público do gatilho</Label>
                            <Select value={editTriggerType} onValueChange={setEditTriggerType}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">Todos e grupos</SelectItem>
                                    <SelectItem value="PRIVATE">Somente conversas privadas</SelectItem>
                                    <SelectItem value="GROUP">Somente grupos</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Mensagem de resposta (opcional)</Label>
                            <EmojiTextarea
                                value={editResponse}
                                onValueChange={setEditResponse}
                                placeholder="Texto da resposta..." 
                                className="min-h-[120px]"
                            />
                            <p className="text-xs text-muted-foreground">Você pode usar a formatação padrão do WhatsApp (*negrito*, _itálico_, ~riscado~)</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>URL da mídia (opcional)</Label>
                                <Input 
                                    value={editMediaUrl} 
                                    onChange={(e) => setEditMediaUrl(e.target.value)} 
                                    placeholder="https://exemplo.com/imagem.jpg" 
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Tipo de mídia</Label>
                                <Select value={editMediaType} onValueChange={setEditMediaType}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="image">Imagem</SelectItem>
                                        <SelectItem value="video">Vídeo</SelectItem>
                                        <SelectItem value="document">Documento</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancelar</Button>
                        <Button onClick={handleUpdate} disabled={submitting || !editKeyword.trim() || (!editResponse.trim() && !editMediaUrl.trim())}>
                            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Salvar alterações"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
        </SessionGuard>
    );
}
