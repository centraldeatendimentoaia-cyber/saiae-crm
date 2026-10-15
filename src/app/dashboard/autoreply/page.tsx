"use client";

import { errorMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";

import { useState, useEffect } from "react";
import { useSession } from "@/components/dashboard/session-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { BotMessageSquare, Loader2, Plus } from "lucide-react";
import { DialogTrigger } from "@/components/ui/dialog";
import { getAutoReplies, createAutoReply, deleteAutoReply, updateAutoReply } from "./actions";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { EMPTY_RULE_FORM, ruleFormValid, toRuleInput, type AutoReply, type RuleFormValues } from "./_components/types";
import { RuleCard } from "./_components/rule-card";
import { RuleDialog } from "./_components/rule-dialog";

export default function AutoReplyPage() {
    const { sessionId } = useSession();
    const [rules, setRules] = useState<AutoReply[]>([]);
    const [loading, setLoading] = useState(false);

    // Form states
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [form, setForm] = useState<RuleFormValues>(EMPTY_RULE_FORM);

    // Edit states
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<RuleFormValues>(EMPTY_RULE_FORM);

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
        if (!ruleFormValid(form)) {
            toast.error("Palavra-chave e resposta (ou URL de mídia) são obrigatórias");
            return;
        }

        setSubmitting(true);
        try {
            // Using direct Server Action instead of API route
            await createAutoReply(sessionId, toRuleInput(form));

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

    const resetForm = () => setForm(EMPTY_RULE_FORM);

    const handleEdit = (rule: AutoReply) => {
        setEditId(rule.id);
        setEditForm({
            keyword: rule.keyword,
            response: rule.response || "",
            matchType: rule.matchType,
            triggerType: rule.triggerType,
            mediaUrl: rule.mediaUrl || "",
            mediaType: rule.mediaType || "image",
        });
        setIsEditOpen(true);
    };

    const handleUpdate = async () => {
        if (!sessionId || !editId) return;
        if (!ruleFormValid(editForm)) {
            toast.error("Palavra-chave e resposta (ou URL de mídia) são obrigatórias");
            return;
        }

        setSubmitting(true);
        try {
            await updateAutoReply(sessionId, editId, toRuleInput(editForm));

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

                <RuleDialog
                    open={isCreateOpen}
                    onOpenChange={(open) => {
                        setIsCreateOpen(open);
                        if (!open) resetForm();
                    }}
                    title="Criar regra de resposta automática"
                    description="Adicione uma nova resposta baseada em palavra-chave."
                    submitLabel="Salvar regra"
                    values={form}
                    onChange={setForm}
                    responsePlaceholder="Obrigado pela sua mensagem! Nossa equipe retornará em breve."
                    submitting={submitting}
                    onSubmit={handleCreate}
                    trigger={
                        <DialogTrigger asChild>
                            <Button>
                                <Plus className="w-4 h-4 mr-2" />
                                Nova regra
                            </Button>
                        </DialogTrigger>
                    }
                />
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
                        <RuleCard key={rule.id} rule={rule} onEdit={handleEdit} onDelete={handleDelete} />
                    ))}
                </div>
            )}

            {/* Edit Auto-Reply Dialog Modal */}
            <RuleDialog
                open={isEditOpen}
                onOpenChange={(open) => {
                    setIsEditOpen(open);
                    if (!open) setEditId(null);
                }}
                title="Editar regra de resposta automática"
                description="Modifique a regra de resposta por palavra-chave."
                submitLabel="Salvar alterações"
                values={editForm}
                onChange={setEditForm}
                responsePlaceholder="Texto da resposta..."
                submitting={submitting}
                onSubmit={handleUpdate}
            />
        </div>
        </SessionGuard>
    );
}
