"use client";

import { parseRecipients } from "@/lib/phone";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmojiTextarea } from "@/components/emoji-textarea";
import { MediaUpload } from "@/components/media-upload";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Plus, CalendarClock, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import moment from "moment-timezone";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { SearchFilter } from "@/components/dashboard/search-filter";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { parseRecurrence, buildCronData } from "./_components/recurrence";
import { RecurrenceForm } from "./_components/recurrence-form";
import { PendingList, HistoryList, DeleteDialog, type ScheduledMessage } from "./_components/message-list";

export default function SchedulerPage() {
    const { sessionId: selectedSessionId } = useSession();

    const [messages, setMessages] = useState<ScheduledMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [systemTimezone, setSystemTimezone] = useState("America/Sao_Paulo");
    const [activeTab, setActiveTab] = useState("pending");

    // Form state
    const [showForm, setShowForm] = useState(false);
    const [newJidType, setNewJidType] = useState("personal");
    const [newJid, setNewJid] = useState("");
    const [newContent, setNewContent] = useState("");
    const [newSendAt, setNewSendAt] = useState("");
    const [newSendTime, setNewSendTime] = useState("");
    const [newMediaUrl, setNewMediaUrl] = useState("");
    const [newMediaType, setNewMediaType] = useState("image");
    
    // Recurrence State for Create
    const [isRecurring, setIsRecurring] = useState("once");
    const [recurrenceType, setRecurrenceType] = useState("minutes");
    const [recurringMinutes, setRecurringMinutes] = useState(5);
    const [recurringHours, setRecurringHours] = useState(1);
    const [recurringDays, setRecurringDays] = useState<number[]>([]);
    const [customCron, setCustomCron] = useState("");

    // Delete state
    const [deleteId, setDeleteId] = useState<string | null>(null);

    // Edit state
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [editJidType, setEditJidType] = useState("personal");
    const [editJid, setEditJid] = useState("");
    const [editContent, setEditContent] = useState("");
    const [editSendAt, setEditSendAt] = useState("");
    const [editSendTime, setEditSendTime] = useState("");
    const [editMediaUrl, setEditMediaUrl] = useState("");
    const [editMediaType, setEditMediaType] = useState("image");

    const [editIsRecurring, setEditIsRecurring] = useState("once");
    const [editRecurrenceType, setEditRecurrenceType] = useState("minutes");
    const [editRecurringMinutes, setEditRecurringMinutes] = useState(5);
    const [editRecurringHours, setEditRecurringHours] = useState(1);
    const [editRecurringDays, setEditRecurringDays] = useState<number[]>([]);
    const [editCustomCron, setEditCustomCron] = useState("");

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
        } catch (error) {
            toast.error("Falha ao carregar as mensagens agendadas");
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (msg: ScheduledMessage) => {
        setEditId(msg.id);
        const isGroup = msg.jid.includes("@g.us");
        const isNewsletter = msg.jid.includes("@newsletter");
        setEditJidType(isGroup ? "group" : isNewsletter ? "newsletter" : "personal");
        const jidUser = msg.jid.split('@')[0];
        setEditJid(jidUser);
        setEditContent(msg.content || "");
        setEditMediaUrl(msg.mediaUrl || "");
        setEditMediaType(msg.mediaType || "image");
        
        const localIso = moment.tz(msg.sendAt, systemTimezone).format('YYYY-MM-DDTHH:mm');
        setEditSendAt(localIso);
        
        const localTime = moment.tz(msg.sendAt, systemTimezone).format('HH:mm');
        setEditSendTime(localTime);
        
        parseRecurrence(msg.recurrenceRule, msg.cronExpression, {
            setRecurring: setEditIsRecurring, setType: setEditRecurrenceType, setMins: setEditRecurringMinutes,
            setHrs: setEditRecurringHours, setDays: setEditRecurringDays, setCron: setEditCustomCron,
        });

        setIsEditOpen(true);
    };

    const handleSaveSchedule = async () => {
        if (!selectedSessionId || !newJid || (!newContent && !newMediaUrl)) {
            toast.error("Preencha os campos obrigatórios (JID, conteúdo/mídia)");
            return;
        }

        let finalSendAt = newSendAt;
        if (isRecurring === "recurring") {
            if (recurrenceType === "days") {
                if (!newSendTime) {
                    toast.error("Informe o horário do dia");
                    return;
                }
                // Construct a valid local date-time string
                finalSendAt = `${moment().format('YYYY-MM-DD')}T${newSendTime}:00`;
            } else {
                // For minutes, hours, cron: start from now
                finalSendAt = moment().tz(systemTimezone).format('YYYY-MM-DDTHH:mm:ss');
            }
        } else {
            if (!newSendAt) {
                toast.error("Informe a data e hora de envio");
                return;
            }
        }

        let jids: string[];
        if (newJidType === "personal") {
            jids = parseRecipients(newJid);
            if (jids.length === 0) {
                toast.error("Informe ao menos um número válido");
                return;
            }
        } else {
            let single = newJid.trim();
            if (!single.includes("@")) single += newJidType === "group" ? "@g.us" : "@newsletter";
            jids = [single];
        }

        const cronData = buildCronData(isRecurring, recurrenceType, recurringMinutes, recurringHours, recurringDays, customCron, finalSendAt);

        try {
            const res = await fetch(`/api/scheduler/${selectedSessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...(jids.length > 1 ? { jids, spacingMs: 5000 } : { jid: jids[0] }),
                    content: newContent,
                    sendAt: finalSendAt,
                    mediaUrl: newMediaUrl,
                    mediaType: newMediaType,
                    ...cronData
                })
            });

            if (res.ok) {
                toast.success(jids.length > 1 ? `${jids.length} mensagens agendadas` : "Mensagem agendada");
                setShowForm(false);
                setNewJid("");
                setNewContent("");
                setNewSendAt("");
                setNewSendTime("");
                setNewMediaUrl("");
                setNewMediaType("image");
                setNewJidType("personal");
                fetchMessages(selectedSessionId, activeTab);
            } else {
                toast.error("Falha ao agendar a mensagem");
            }
        } catch (error) {
            toast.error("Ocorreu um erro");
        }
    };

    const handleUpdateSchedule = async () => {
        if (!selectedSessionId || !editId || !editJid || (!editContent && !editMediaUrl)) {
            toast.error("Preencha os campos obrigatórios");
            return;
        }

        let finalSendAt = editSendAt;
        if (editIsRecurring === "recurring") {
            if (editRecurrenceType === "days") {
                if (!editSendTime) {
                    toast.error("Informe o horário do dia");
                    return;
                }
                finalSendAt = `${moment().format('YYYY-MM-DD')}T${editSendTime}:00`;
            } else {
                finalSendAt = moment().tz(systemTimezone).format('YYYY-MM-DDTHH:mm:ss');
            }
        } else {
            if (!editSendAt) {
                toast.error("Informe a data e hora de envio");
                return;
            }
        }

        let jid = editJid;
        if (!jid.includes("@")) {
            if (editJidType === "group") jid += "@g.us";
            else if (editJidType === "newsletter") jid += "@newsletter";
            else jid += "@s.whatsapp.net";
        }

        const cronData = buildCronData(editIsRecurring, editRecurrenceType, editRecurringMinutes, editRecurringHours, editRecurringDays, editCustomCron, finalSendAt);

        try {
            const res = await fetch(`/api/scheduler/${selectedSessionId}/${editId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jid,
                    content: editContent,
                    sendAt: finalSendAt,
                    mediaUrl: editMediaUrl,
                    mediaType: editMediaType,
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
        } catch (error) {
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
        } catch (error) {
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
                    <Card className="border-2 border-primary/20">
                        <CardHeader>
                            <CardTitle>Agendar nova mensagem</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <Label>Destinatários</Label>
                                    <RadioGroup value={newJidType} onValueChange={setNewJidType} className="flex gap-4">
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="personal" id="new-personal" />
                                            <Label htmlFor="new-personal" className="cursor-pointer">Pessoal</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="group" id="new-group" />
                                            <Label htmlFor="new-group" className="cursor-pointer">Grupo</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="newsletter" id="new-newsletter" />
                                            <Label htmlFor="new-newsletter" className="cursor-pointer">Canal</Label>
                                        </div>
                                    </RadioGroup>
                                </div>
                                {newJidType === "personal" ? (
                                    <>
                                        <Textarea
                                            value={newJid}
                                            onChange={e => setNewJid(e.target.value)}
                                            placeholder={"5511999999999\n5511988888888"}
                                            className="min-h-[120px] font-mono"
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            {parseRecipients(newJid).length} números identificados. Um por linha ou separados por vírgula.
                                            {parseRecipients(newJid).length > 1 && " As mensagens saem uma a uma, com alguns segundos entre elas."}
                                        </p>
                                    </>
                                ) : (
                                    <Input value={newJid} onChange={e => setNewJid(e.target.value)} placeholder={newJidType === 'group' ? "120363... (ID do grupo)" : "120363... (ID do canal)"} />
                                )}
                            </div>
                            
                            <RecurrenceForm
                                isRec={isRecurring} setRec={setIsRecurring}
                                type={recurrenceType} setType={setRecurrenceType}
                                mins={recurringMinutes} setMins={setRecurringMinutes}
                                hrs={recurringHours} setHrs={setRecurringHours}
                                days={recurringDays} setDays={setRecurringDays}
                                cron={customCron} setCron={setCustomCron}
                                sendAtStr={newSendAt} setSendAtStr={setNewSendAt}
                                sendTimeStr={newSendTime} setSendTimeStr={setNewSendTime}
                            />

                            <div className="space-y-2 mt-4">
                                <Label>Mensagem (opcional)</Label>
                                <EmojiTextarea value={newContent} onValueChange={setNewContent} placeholder="Olá!" className="min-h-[110px]" />
                            </div>

                            <div className="space-y-2 mt-4">
                                <Label>Imagem (opcional)</Label>
                                <MediaUpload value={newMediaUrl.startsWith("/api/uploads/") ? newMediaUrl : ""} onChange={u => { setNewMediaUrl(u); if (u) setNewMediaType("image"); }} />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Ou URL da mídia (opcional)</Label>
                                    <Input value={newMediaUrl} onChange={e => setNewMediaUrl(e.target.value)} placeholder="https://..." />
                                </div>
                                <div className="space-y-2">
                                    <Label>Tipo de mídia</Label>
                                    <Select value={newMediaType} onValueChange={setNewMediaType}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="image">Imagem</SelectItem>
                                            <SelectItem value="video">Vídeo</SelectItem>
                                            <SelectItem value="document">Documento</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 mt-4">
                                <Button variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
                                <Button onClick={handleSaveSchedule} disabled={(!newContent && !newMediaUrl) || !newJid}>Agendar</Button>
                            </div>
                        </CardContent>
                    </Card>
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

                <Dialog open={isEditOpen} onOpenChange={o => !o && setIsEditOpen(false)}>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Editar agendamento</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <Label>JID do destinatário</Label>
                                    <RadioGroup value={editJidType} onValueChange={setEditJidType} className="flex gap-4">
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="personal" id="edit-personal" />
                                            <Label htmlFor="edit-personal" className="cursor-pointer">Pessoal</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="group" id="edit-group" />
                                            <Label htmlFor="edit-group" className="cursor-pointer">Grupo</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="newsletter" id="edit-newsletter" />
                                            <Label htmlFor="edit-newsletter" className="cursor-pointer">Canal</Label>
                                        </div>
                                    </RadioGroup>
                                </div>
                                <Input value={editJid} onChange={e => setEditJid(e.target.value)} placeholder={editJidType === 'group' ? "120363... (ID do grupo)" : editJidType === 'newsletter' ? "120363... (ID do canal)" : "62812345678"} />
                            </div>
                            
                            <RecurrenceForm
                                isRec={editIsRecurring} setRec={setEditIsRecurring}
                                type={editRecurrenceType} setType={setEditRecurrenceType}
                                mins={editRecurringMinutes} setMins={setEditRecurringMinutes}
                                hrs={editRecurringHours} setHrs={setEditRecurringHours}
                                days={editRecurringDays} setDays={setEditRecurringDays}
                                cron={editCustomCron} setCron={setEditCustomCron}
                                sendAtStr={editSendAt} setSendAtStr={setEditSendAt}
                                sendTimeStr={editSendTime} setSendTimeStr={setEditSendTime}
                            />

                            <div className="space-y-2 mt-4">
                                <Label>Mensagem (opcional)</Label>
                                <EmojiTextarea value={editContent} onValueChange={setEditContent} className="min-h-[110px]" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>URL da mídia (opcional)</Label>
                                    <Input value={editMediaUrl} onChange={e => setEditMediaUrl(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Tipo de mídia</Label>
                                    <Select value={editMediaType} onValueChange={setEditMediaType}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
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
                            <Button variant="ghost" onClick={() => setIsEditOpen(false)}>Cancelar</Button>
                            <Button onClick={handleUpdateSchedule} disabled={(!editContent && !editMediaUrl) || !editJid}>Salvar alterações</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </SessionGuard>
    );
}
