"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmojiTextarea } from "@/components/emoji-textarea";
import { MediaUpload } from "@/components/media-upload";
import { RecipientPicker } from "@/components/recipient-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { parseRecipients } from "@/lib/phone";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { RefreshCw, Send, History, Calendar } from "lucide-react";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { useSocket } from "@/components/chat/socket-context";
import type { BroadcastProgress, BroadcastLog } from "./_components/types";
import { ProgressCard } from "./_components/progress-card";
import { HistoryTab, DetailDialog } from "./_components/history-tab";
import { ScheduleDialog, RiskDialog } from "./_components/dialogs";
import { useAiCopies } from "./_components/use-ai-copies";
import { RecipientsCard, MessageCard } from "./_components/message-cards";

export default function BroadcastPage() {
    const { sessionId } = useSession();
    const [contacts, setContacts] = useState("");
    const [message, setMessage] = useState("");

    const ai = useAiCopies();
    const [delay, setDelay] = useState([2000]);
    const [quota, setQuota] = useState<{ used: number; max: number | null } | null>(null);
    useEffect(() => {
        fetch("/api/me/plan").then(r => r.json()).then(j => {
            if (j.status) setQuota({ used: j.data.usage.messages, max: j.data.limits.messages });
        }).catch(() => {});
    }, [sessionId]);
    const [mediaUrl, setMediaUrl] = useState("");
    const [optOutFooter, setOptOutFooter] = useState(true);
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [scheduleAt, setScheduleAt] = useState("");
    const [scheduling, setScheduling] = useState(false);

    const handleSchedule = async () => {
        if (!sessionId) return toast.error("Nenhuma sessão ativa encontrada");
        if (!message.trim() && !mediaUrl) return toast.error("A mensagem não pode estar vazia");
        const recipients = parseRecipients(contacts);
        if (recipients.length === 0) return toast.error("Nenhum destinatário informado");
        if (!scheduleAt) return toast.error("Informe a data e a hora do disparo");
        setScheduling(true);
        try {
            const res = await fetch(`/api/scheduler/${sessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jids: recipients,
                    content: message,
                    variants: variants.map(v => v.trim()).filter(Boolean),
                    mediaUrl: mediaUrl || undefined,
                    mediaType: mediaUrl ? "image" : undefined,
                    optOutFooter,
                    sendAt: scheduleAt,
                    spacingMs: Math.max(3000, delay[0]),
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.status) throw new Error(data.message || "Falha ao agendar o disparo");
            toast.success(`Disparo agendado para ${recipients.length} ${recipients.length === 1 ? "número" : "números"}. Acompanhe no Agendador.`);
            setScheduleOpen(false);
            setScheduleAt("");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao agendar o disparo");
        } finally {
            setScheduling(false);
        }
    };
    const [loading, setLoading] = useState(false);
    const [broadcastProgress, setBroadcastProgress] = useState<BroadcastProgress | null>(null);
    const [activeTab, setActiveTab] = useState<"new" | "history">("new");

    // History
    const [history, setHistory] = useState<BroadcastLog[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [selectedLog, setSelectedLog] = useState<BroadcastLog | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [riskOpen, setRiskOpen] = useState(false);
    const [variants, setVariants] = useState<string[]>([]);
    const [detailLoading, setDetailLoading] = useState(false);

    const { getSocket, joinSession } = useSocket();

    // Socket for progress updates
    useEffect(() => {
        const socket = getSocket();
        if (!socket || !sessionId) return;

        const onConnect = () => joinSession(sessionId);
        if (socket.connected) joinSession(sessionId);
        socket.on("connect", onConnect);

        const handler = (data: BroadcastProgress) => {
            setBroadcastProgress(data);
            if (data.status === "stopped" || data.status === "cancelled") {
                setLoading(false);
                fetchHistory();
                toast.error(data.note || "Disparo interrompido.", { duration: 12000 });
            } else if (data.status === "completed") {
                setLoading(false);
                // Refresh history after completion
                fetchHistory();
                if (data.sent === 0 && data.failed > 0) {
                    const counts: Record<string, number> = {};
                    for (const e of data.errors || []) counts[e.error] = (counts[e.error] || 0) + 1;
                    const top = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];
                    toast.error(`Nenhuma mensagem foi enviada. Motivo mais comum: ${top ? top[0] : "erro desconhecido"} (${top ? top[1] : data.failed} contatos).`, { duration: 15000 });
                } else if (data.deferred) {
                    toast.info(`${data.sent} enviadas agora. ${data.deferred} continuam automaticamente dentro do horário seguro.`, { duration: 10000 });
                } else if (data.failed === 0) {
                    toast.success(`Disparo concluído! ${data.sent} enviadas.`);
                } else {
                    toast.warning(`Disparo concluído. ${data.sent} enviadas, ${data.failed} com falha.`);
                }
            }
        };

        socket.on("broadcast.progress", handler);
        return () => { socket.off("connect", onConnect); socket.off("broadcast.progress", handler); };
    }, [sessionId, getSocket, joinSession]);

    // Ao entrar (ou voltar) na tela, retoma o disparo em andamento e acompanha o progresso
    const wasRunning = useRef(false);
    useEffect(() => {
        if (!sessionId) return;
        let stop = false;
        let timer: ReturnType<typeof setTimeout>;
        const tick = async () => {
            try {
                const res = await fetch(`/api/messages/${sessionId}/broadcast/history?limit=1`);
                const j = await res.json();
                const l = j?.data?.[0];
                if (!stop && l) {
                    if (l.status === "running") {
                        wasRunning.current = true;
                        setLoading(true);
                        setBroadcastProgress(p => ({ ...(p || {}), broadcastId: l.id, status: "running", total: l.total, sent: l.sent, failed: l.failed, progress: l.total ? Math.round(((l.sent + l.failed) / l.total) * 100) : 0 } as BroadcastProgress));
                    } else if (wasRunning.current) {
                        wasRunning.current = false;
                        setLoading(false);
                        setBroadcastProgress(p => (p && p.status === "running" ? { ...p, status: l.status === "cancelled" ? "cancelled" : l.status === "stopped" ? "stopped" : "completed", sent: l.sent, failed: l.failed, progress: 100 } : p));
                        fetchHistory();
                    }
                }
            } catch { /* tenta de novo */ }
            if (!stop) timer = setTimeout(tick, 4000);
        };
        tick();
        return () => { stop = true; clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    const cancelBroadcast = async () => {
        if (!window.confirm("Cancelar o disparo? As mensagens que faltam não serão enviadas.")) return;
        const res = await fetch(`/api/messages/${sessionId}/broadcast/cancel`, { method: "POST" });
        if (res.ok) toast.info("Cancelando... o envio para na próxima mensagem.");
        else toast.error("Não foi possível cancelar.");
    };

    // Fetch history
    const fetchHistory = useCallback(async () => {
        if (!sessionId) return;
        setHistoryLoading(true);
        try {
            const res = await fetch(`/api/messages/${sessionId}/broadcast/history?limit=20`);
            if (res.ok) {
                const data = await res.json();
                setHistory(data.data || []);
            }
        } catch (e) {
            logger.error("Broadcast", "Falha ao carregar o histórico de disparos", e);
        } finally {
            setHistoryLoading(false);
        }
    }, [sessionId]);

    // Load history on mount & tab switch
    useEffect(() => {
        if (activeTab === "history" && sessionId) {
            fetchHistory();
        }
    }, [activeTab, sessionId, fetchHistory]);

    // Open detail modal
    const openDetail = async (log: BroadcastLog) => {
        setSelectedLog(log);
        setDetailOpen(true);
        setDetailLoading(true);
        try {
            const res = await fetch(`/api/messages/${sessionId}/broadcast/history/${log.id}`);
            if (res.ok) {
                const data = await res.json();
                setSelectedLog(data.data);
            }
        } catch (e) {
            logger.error("Broadcast", "Falha ao carregar os detalhes do disparo", e);
        } finally {
            setDetailLoading(false);
        }
    };

    const BIG_SEND = 100;

    // Disparos grandes pedem confirmação, com o aviso de risco de bloqueio
    const handleSend = () => {
        if (!sessionId) return toast.error("Nenhuma sessão ativa encontrada");
        if (!message.trim() && !mediaUrl) return toast.error("A mensagem não pode estar vazia");
        if (parseRecipients(contacts).length > BIG_SEND) { setRiskOpen(true); return; }
        doSend();
    };

    const doSend = async () => {
        setRiskOpen(false);
        if (!sessionId) return;
        setLoading(true);
        setBroadcastProgress(null);

        try {
            const recipients = parseRecipients(contacts);

            if (recipients.length === 0) {
                toast.error("Nenhum destinatário informado");
                setLoading(false);
                return;
            }

            const res = await fetch(`/api/messages/${sessionId}/broadcast`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    recipients,
                    message,
                    variants: variants.map(v => v.trim()).filter(Boolean),
                    mediaUrl: mediaUrl || undefined,
                    optOutFooter,
                    delay: delay[0]
                })
            });

            const data = await res.json();

            if (res.ok) {
                toast.info(`Disparo iniciado para ${recipients.length} destinatários...`);
            } else {
                toast.error(data.message || "Falha ao iniciar o disparo");
                setLoading(false);
            }
        } catch (e) {
            logger.error("Broadcast", "Erro ao enviar o disparo", e);
            toast.error("Erro ao enviar o disparo");
            setLoading(false);
        }
    };

    const recipientCount = parseRecipients(contacts).length;

    const tabs = [
        { id: "new" as const, label: "Novo disparo", icon: Send },
        { id: "history" as const, label: "Histórico", icon: History },
    ];

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div>
                    <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Disparo em massa</h2>
                    <p className="text-muted-foreground text-sm mt-1">Envie mensagens em massa para vários destinatários de uma vez.</p>
                </div>

                {/* Progresso no topo da tela */}
                {broadcastProgress && <ProgressCard progress={broadcastProgress} onCancel={cancelBroadcast} />}

                {/* Tabs */}
                <div className="flex gap-1 bg-muted/50 p-1 rounded-lg w-fit">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${
                                activeTab === tab.id
                                    ? "bg-background shadow-sm text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <tab.icon className="h-4 w-4" />
                            {tab.label}
                        </button>
                    ))}
                </div>

                {activeTab === "new" && (
                    <>
                        <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2">
                            <RecipientsCard
                                sessionId={sessionId}
                                contacts={contacts}
                                onContactsChange={setContacts}
                                loading={loading}
                                recipientCount={recipientCount}
                                quota={quota}
                            />
                            <MessageCard
                                message={message}
                                setMessage={setMessage}
                                variants={variants}
                                setVariants={setVariants}
                                mediaUrl={mediaUrl}
                                setMediaUrl={setMediaUrl}
                                optOutFooter={optOutFooter}
                                setOptOutFooter={setOptOutFooter}
                                delay={delay}
                                setDelay={setDelay}
                                loading={loading}
                                ai={ai}
                                canSend={!(loading || !sessionId || recipientCount === 0 || (!message.trim() && !mediaUrl))}
                                sending={loading}
                                onSend={handleSend}
                                onSchedule={() => setScheduleOpen(true)}
                            />
                        </div>
                    </>
                )}

                {activeTab === "history" && (
                    <HistoryTab history={history} loading={historyLoading} onOpenDetail={openDetail} />
                )}

                <DetailDialog open={detailOpen} onOpenChange={setDetailOpen} log={selectedLog} loading={detailLoading} />
            </div>
            <ScheduleDialog
                open={scheduleOpen}
                onOpenChange={setScheduleOpen}
                recipientCount={recipientCount}
                delayMs={delay[0]}
                hasVariants={variants.some(v => v.trim() !== "")}
                hasMedia={!!mediaUrl}
                scheduleAt={scheduleAt}
                onScheduleAtChange={setScheduleAt}
                scheduling={scheduling}
                onSchedule={handleSchedule}
            />
            <RiskDialog open={riskOpen} onOpenChange={setRiskOpen} recipientCount={recipientCount} onConfirm={doSend} />
        </SessionGuard>
    );
}
