"use client";

import { TZ_SAO_PAULO } from "@/modules/atendimento-comum/tempo";
import { parseRecipients } from "@/lib/phone";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, CalendarClock, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { SearchFilter } from "@/components/dashboard/search-filter";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { PendingList, HistoryList, DeleteDialog, type ScheduledMessage } from "./_components/message-list";
import { NewScheduleCard } from "./_components/new-schedule-card";
import { EditScheduleDialog } from "./_components/edit-schedule-dialog";
import { EMPTY_SCHEDULE_FORM, computeSendAt, cronDataFor, formFromMessage, jidWithSuffix, type ScheduleFormValues } from "./_components/schedule-form";

export default function SchedulerPage() {
    const { sessionId: selectedSessionId } = useSession();

    const [messages, setMessages] = useState<ScheduledMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [systemTimezone, setSystemTimezone] = useState(TZ_SAO_PAULO);
    const [activeTab, setActiveTab] = useState("pending");

    // Form state
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState<ScheduleFormValues>(EMPTY_SCHEDULE_FORM);
    const patchForm = (patch: Partial<ScheduleFormValues>) => setForm(prev => ({ ...prev, ...patch }));

    // Delete state
    const [deleteId, setDeleteId] = useState<string | null>(null);

    // Edit state
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<ScheduleFormValues>(EMPTY_SCHEDULE_FORM);
    const patchEditForm = (patch: Partial<ScheduleFormValues>) => setEditForm(prev => ({ ...prev, ...patch }));

    useEffect(() => {
        fetch('/api/settings/system')
            .then(res => res.json())
            .then(data => {
                if (data.status && data.data?.timezone) {
                    setSystemTimezone(data.data.timezone);
                }
            })
            .catch(() => { });
    }, []);

    useEffect(() => {
        if (selectedSessionId) {
            fetchMessages(selectedSessionId, activeTab);
        } else {
            setMessages([]);
        }
    }, [selectedSessionId, activeTab]);

    const fetchMessages = async (sessionId: string, tab: string) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/scheduler/${sessionId}?tab=${tab}`);
            if (res.ok) {
                const data = await res.json();
                setMessages(data?.data || []);
            } else {
                setMessages([]);
            }
        } catch {
            toast.error("Falha ao carregar as mensagens agendadas");
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (msg: ScheduledMessage) => {
        setEditId(msg.id);
        setEditForm(formFromMessage(msg, systemTimezone));
        setIsEditOpen(true);
    };

    const handleSaveSchedule = async () => {
        if (!selectedSessionId || !form.jid || (!form.content && !form.mediaUrl)) {
            toast.error("Preencha os campos obrigatórios (JID, conteúdo/mídia)");
            return;
        }

        const when = computeSendAt(form, systemTimezone);
        if ("error" in when) {
            toast.error(when.error);
            return;
        }
        const finalSendAt = when.value;

        let jids: string[];
        if (form.jidType === "personal") {
            jids = parseRecipients(form.jid);
            if (jids.length === 0) {
                toast.error("Informe ao menos um número válido");
                return;
            }
        } else {
            let single = form.jid.trim();
            if (!single.includes("@")) single += form.jidType === "group" ? "@g.us" : "@newsletter";
            jids = [single];
        }

        const cronData = cronDataFor(form, finalSendAt);

        try {
            const res = await fetch(`/api/scheduler/${selectedSessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...(jids.length > 1 ? { jids, spacingMs: 5000 } : { jid: jids[0] }),
                    content: form.content,
                    sendAt: finalSendAt,
                    mediaUrl: form.mediaUrl,
                    mediaType: form.mediaType,
                    ...cronData
                })
            });

            if (res.ok) {
                toast.success(jids.length > 1 ? `${jids.length} mensagens agendadas` : "Mensagem agendada");
                setShowForm(false);
                // limpa só os campos de conteúdo; a recorrência escolhida fica para o próximo agendamento
                patchForm({ jid: "", content: "", sendAt: "", sendTime: "", mediaUrl: "", mediaType: "image", jidType: "personal" });
                fetchMessages(selectedSessionId, activeTab);
            } else {
                toast.error("Falha ao agendar a mensagem");
            }
        } catch {
            toast.error("Ocorreu um erro");
        }
    };

    const handleUpdateSchedule = async () => {
        if (!selectedSessionId || !editId || !editForm.jid || (!editForm.content && !editForm.mediaUrl)) {
            toast.error("Preencha os campos obrigatórios");
            return;
        }

        const when = computeSendAt(editForm, systemTimezone);
        if ("error" in when) {
            toast.error(when.error);
            return;
        }
        const finalSendAt = when.value;

        const jid = jidWithSuffix(editForm.jid, editForm.jidType);
        const cronData = cronDataFor(editForm, finalSendAt);

        try {
            const res = await fetch(`/api/scheduler/${selectedSessionId}/${editId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jid,
                    content: editForm.content,
                    sendAt: finalSendAt,
                    mediaUrl: editForm.mediaUrl,
                    mediaType: editForm.mediaType,
                    ...cronData
                })
            });

            if (res.ok) {
                toast.success("Agendamento atualizado");
                setIsEditOpen(false);
                fetchMessages(selectedSessionId, activeTab);
            } else {
                toast.error("Falha ao atualizar o agendamento");
            }
        } catch {
            toast.error("Ocorreu um erro");
        }
    };

    const confirmDelete = async () => {
        if (!deleteId) return;
        try {
            const res = await fetch(`/api/scheduler/${selectedSessionId}/${deleteId}`, { method: "DELETE" });
            if (res.ok) {
                toast.success("Agendamento excluído");
                fetchMessages(selectedSessionId, activeTab);
            } else {
                toast.error("Falha ao excluir o agendamento");
            }
        } catch {
            toast.error("Falha ao excluir o agendamento");
        } finally {
            setDeleteId(null);
        }
    };

    const filteredMessages = messages.filter(m =>
        (m.content || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.jid.includes(searchTerm)
    );

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                            <CalendarClock className="h-5 w-5 sm:h-6 sm:w-6" />  Agendador
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            {selectedSessionId ? "Agende mensagens para a sessão ativa." : "Selecione uma sessão na barra superior."}
                        </p>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => selectedSessionId && fetchMessages(selectedSessionId, activeTab)} disabled={loading || !selectedSessionId}>
                            <RefreshCw className={`h-4 w-4 mr-1 sm:mr-2 ${loading ? 'animate-spin' : ''}`} />
                            Atualizar
                        </Button>
                        <Button size="sm" className="flex-1 sm:flex-none" onClick={() => setShowForm(!showForm)} disabled={!selectedSessionId}>
                            <Plus className="h-4 w-4 mr-1 sm:mr-2" />  Agendar
                        </Button>
                    </div>
                </div>

                <SearchFilter
                    placeholder="Buscar agendamentos..."
                    onSearch={setSearchTerm}
                />

                {showForm && (
                    <NewScheduleCard values={form} onChange={patchForm} onCancel={() => setShowForm(false)} onSubmit={handleSaveSchedule} />
                )}

                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="mb-4">
                        <TabsTrigger value="pending">Fila pendente</TabsTrigger>
                        <TabsTrigger value="history">Histórico</TabsTrigger>
                    </TabsList>
                    <TabsContent value="pending" className="mt-0">
                        <PendingList messages={filteredMessages} loading={loading} timezone={systemTimezone} onEdit={handleEdit} onDelete={setDeleteId} />
                    </TabsContent>
                    <TabsContent value="history" className="mt-0">
                        <HistoryList messages={filteredMessages} loading={loading} timezone={systemTimezone} onDelete={setDeleteId} />
                    </TabsContent>
                </Tabs>

                <DeleteDialog open={!!deleteId} onCancel={() => setDeleteId(null)} onConfirm={confirmDelete} />

                <EditScheduleDialog
                    open={isEditOpen}
                    onClose={() => setIsEditOpen(false)}
                    values={editForm}
                    onChange={patchEditForm}
                    onSubmit={handleUpdateSchedule}
                />
            </div>
        </SessionGuard>
    );
}
