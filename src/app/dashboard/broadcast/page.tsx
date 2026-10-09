"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { EmojiTextarea } from "@/components/emoji-textarea";
import { MediaUpload } from "@/components/media-upload";
import { RecipientPicker } from "@/components/recipient-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { parseRecipients } from "@/lib/phone";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { RefreshCw, Send, CheckCircle2, XCircle, Radio, Clock, AlertTriangle, History, Eye, Calendar } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { useSocket } from "@/components/chat/socket-context";

interface BroadcastProgress {
    broadcastId: string;
    status: "running" | "completed" | "stopped" | "cancelled";
    total: number;
    sent: number;
    failed: number;
    deferred?: number;
    note?: string;
    current?: string | null;
    progress?: number;
    errors?: { jid: string; error: string }[];
    startedAt?: string;
    completedAt?: string;
}

interface BroadcastLog {
    id: string;
    sessionId: string;
    message: string;
    total: number;
    sent: number;
    failed: number;
    status: string;
    delay: number;
    startedAt: string;
    completedAt: string | null;
    _count?: { recipients: number };
    recipients?: BroadcastRecipient[];
}

interface BroadcastRecipient {
    id: string;
    jid: string;
    status: string;
    error: string | null;
    sentAt: string | null;
}

export default function BroadcastPage() {
    const { sessionId } = useSession();
    const [contacts, setContacts] = useState("");
    const [message, setMessage] = useState("");

    const [aiObjective, setAiObjective] = useState("");
    const [aiLoading, setAiLoading] = useState(false);
    const [aiCopies, setAiCopies] = useState<string[]>([]);

    const generateCopies = async () => {
        if (aiObjective.trim().length < 3) {
            toast.error("Descreva o que você quer comunicar");
            return;
        }
        setAiLoading(true);
        setAiCopies([]);
        try {
            const res = await fetch("/api/ai/copy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ objective: aiObjective }),
            });
            const data = await res.json();
            if (!res.ok || !data.status) throw new Error(data.error || "Falha ao gerar o texto");
            setAiCopies(data.copies);
        } catch (e: any) {
            toast.error(e.message || "Falha ao gerar o texto");
        } finally {
            setAiLoading(false);
        }
    };
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
        } catch (e: any) {
            toast.error(e.message || "Falha ao agendar o disparo");
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
                    toast.success(`Broadcast complete! ${data.sent} sent.`);
                } else {
                    toast.warning(`Broadcast complete. ${data.sent} sent, ${data.failed} failed.`);
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
            console.error("Failed to fetch broadcast history", e);
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
            console.error("Failed to fetch broadcast detail", e);
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
            console.error(e);
            toast.error("Erro ao enviar o disparo");
            setLoading(false);
        }
    };

    const recipientCount = parseRecipients(contacts).length;
    const formatJid = (jid: string) => {
        if (!jid) return "-";
        return jid.replace("@s.whatsapp.net", "").replace("@g.us", " (Group)");
    };

    const formatTime = (ts: string) => {
        const d = new Date(ts);
        return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

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
                {broadcastProgress && (
                    <Card className={`border-2 transition-colors ${
                        broadcastProgress.status === "completed"
                            ? (broadcastProgress.failed === 0 ? "border-green-500/30 bg-green-50/30 dark:bg-green-950/10" : "border-yellow-500/30 bg-yellow-50/30 dark:bg-yellow-950/10")
                            : "border-zinc-500/30 bg-zinc-50/30 dark:bg-zinc-950/10"
                    }`}>
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-lg">
                                {broadcastProgress.status === "running" ? (
                                    <><Radio className="h-5 w-5 text-zinc-500 animate-pulse" /><span>Disparo em andamento</span></>
                                ) : (broadcastProgress.status === "stopped" || broadcastProgress.status === "cancelled") ? (
                                    <><AlertTriangle className="h-5 w-5 text-red-500" /><span>{broadcastProgress.status === "cancelled" ? "Disparo cancelado" : "Disparo interrompido"}</span></>
                                ) : broadcastProgress.deferred ? (
                                    <><Clock className="h-5 w-5 text-yellow-500" /><span>Continua automaticamente</span></>
                                ) : broadcastProgress.failed === 0 ? (
                                    <><CheckCircle2 className="h-5 w-5 text-green-500" /><span>Disparo concluído</span></>
                                ) : (
                                    <><AlertTriangle className="h-5 w-5 text-yellow-500" /><span>Disparo concluído com erros</span></>
                                )}
                            </CardTitle>
                            <CardDescription className="flex items-center justify-between gap-2">
                                <span>ID: {broadcastProgress.broadcastId}</span>
                                {broadcastProgress.status === "running" && (
                                    <Button size="sm" variant="outline" onClick={cancelBroadcast}>Cancelar disparo</Button>
                                )}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Progresso</span>
                                    <span className="font-mono font-medium">
                                        {broadcastProgress.sent + broadcastProgress.failed} / {broadcastProgress.total} ({broadcastProgress.progress || 0}%)
                                    </span>
                                </div>
                                <Progress value={broadcastProgress.progress || 0} className="h-3" />
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <div className="bg-background rounded-lg p-3 text-center border">
                                    <div className="text-2xl font-bold text-green-600">{broadcastProgress.sent}</div>
                                    <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                                        <CheckCircle2 className="h-3 w-3" />  Enviadas
                                    </div>
                                </div>
                                <div className="bg-background rounded-lg p-3 text-center border">
                                    <div className="text-2xl font-bold text-red-500">{broadcastProgress.failed}</div>
                                    <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                                        <XCircle className="h-3 w-3" />  Falhas
                                    </div>
                                </div>
                                <div className="bg-background rounded-lg p-3 text-center border">
                                    <div className="text-2xl font-bold text-muted-foreground">
                                        {broadcastProgress.total - broadcastProgress.sent - broadcastProgress.failed}
                                    </div>
                                    <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                                        <Clock className="h-3 w-3" />  Pendentes
                                    </div>
                                </div>
                            </div>

                            {broadcastProgress.note && (
                                <p className="rounded-lg border bg-muted/50 px-3 py-2 text-sm">{broadcastProgress.note}</p>
                            )}

                            {broadcastProgress.status === "running" && broadcastProgress.current && (
                                <div className="flex items-center gap-2 text-sm px-3 py-2 bg-muted/50 rounded-lg">
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-zinc-500" />
                                    <span className="text-muted-foreground">Enviando agora:</span>
                                    <span className="font-mono font-medium">{formatJid(broadcastProgress.current)}</span>
                                </div>
                            )}

                            {broadcastProgress.status !== "running" && broadcastProgress.errors && broadcastProgress.errors.length > 0 && (
                                <div className="space-y-2">
                                    <h4 className="text-sm font-semibold text-red-600 flex items-center gap-1.5">
                                        <XCircle className="h-4 w-4" />  Falhas ({broadcastProgress.errors.length})
                                    </h4>
                                    <div className="max-h-40 overflow-y-auto bg-red-50 dark:bg-red-950/30 rounded-lg p-2 space-y-1">
                                        {broadcastProgress.errors.map((err, i) => (
                                            <div key={i} className="flex justify-between items-center text-xs py-1 px-2 bg-background/60 rounded">
                                                <span className="font-mono">{formatJid(err.jid)}</span>
                                                <span className="text-red-500 truncate ml-2 max-w-[200px]">{err.error}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

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
                            {/* Recipients Card */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>Destinatários</CardTitle>
                                    <CardDescription>Escolha por contatos, etiquetas, grupos ou planilha, ou digite os números (separados por vírgula ou quebra de linha).</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <RecipientPicker sessionId={sessionId} value={contacts} onChange={setContacts} disabled={loading} />
                                    <div className="space-y-2">
                                        <Label>Lista de destino (ex.: 5511999999999) — você pode editar</Label>
                                        <Textarea
                                            placeholder={"5511999999999\n5511988888888"}
                                            className="min-h-[140px] font-mono text-sm"
                                            value={contacts}
                                            onChange={e => setContacts(e.target.value)}
                                            disabled={loading}
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            {recipientCount}  números identificados
                                            {quota && quota.max !== null && (
                                                <> · restam {Math.max(0, quota.max - quota.used).toLocaleString("pt-BR")} disparos neste mês</>
                                            )}
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Message Card */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>Conteúdo da mensagem</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Mensagem</Label>
                                        <EmojiTextarea
                                            placeholder="Digite sua mensagem aqui..."
                                            className="min-h-[150px]"
                                            value={message}
                                            onValueChange={setMessage}
                                            disabled={loading}
                                            toolbar={
                                                <>
                                                    <span className="ml-1 text-xs text-muted-foreground">Inserir:</span>
                                                    <Button type="button" size="sm" variant="outline" disabled={loading}
                                                        onClick={() => setMessage(m => (m ? m + " " : "") + "{primeironome}")}>
                                                        {"{primeironome}"}
                                                    </Button>
                                                    <Button type="button" size="sm" variant="outline" disabled={loading}
                                                        onClick={() => setMessage(m => (m ? m + " " : "") + "{nome}")}>
                                                        {"{nome}"}
                                                    </Button>
                                                </>
                                            }
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            Cada cliente recebe o próprio nome (ex.: "Oi, {"{primeironome}"}!" vira "Oi, Maria!"). Se o nome não for conhecido, a variável some sozinha. Para escolher um texto reserva, use {"{primeironome|cliente}"}.
                                        </p>
                                    </div>

                                    <div className="space-y-3">
                                        {variants.map((v, i) => (
                                            <div key={i} className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <Label>Versão {i + 2} do texto</Label>
                                                    <Button type="button" size="sm" variant="ghost" disabled={loading}
                                                        onClick={() => setVariants(vs => vs.filter((_, j) => j !== i))}>Remover</Button>
                                                </div>
                                                <EmojiTextarea
                                                    className="min-h-[110px]"
                                                    value={v}
                                                    onValueChange={t => setVariants(vs => vs.map((x, j) => (j === i ? t : x)))}
                                                    disabled={loading}
                                                />
                                            </div>
                                        ))}
                                        {variants.length < 4 && (
                                            <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => setVariants(vs => [...vs, ""])}>
                                                + Adicionar outra versão do texto
                                            </Button>
                                        )}
                                        <p className="text-xs text-muted-foreground">
                                            Com mais de uma versão, os destinatários recebem as versões em rodízio. Mensagens diferentes entre si ajudam a não parecer envio em massa.
                                        </p>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Imagem (opcional)</Label>
                                        <MediaUpload value={mediaUrl} onChange={setMediaUrl} disabled={loading} />
                                    </div>

                                    <label className="flex items-start gap-2 text-sm">
                                        <Checkbox checked={optOutFooter} onCheckedChange={c => setOptOutFooter(c === true)} disabled={loading} className="mt-0.5" />
                                        <span>
                                            Incluir no fim da mensagem: <em>"Para não receber mais mensagens, responda SAIR."</em>
                                            <span className="block text-xs text-muted-foreground">Quem responder SAIR é removido automaticamente dos próximos disparos e agendamentos desse número. Reduz denúncias.</span>
                                        </span>
                                    </label>

                                    <div className="space-y-3 border border-border p-4">
                                        <p className="kicker">Gerar texto com IA</p>
                                        <EmojiTextarea
                                            className="min-h-[130px]"
                                            placeholder={"Descreva o que você quer comunicar, com o máximo de detalhes.\nEx.: promoção de hidratação em outubro para clientes antigas, 20% de desconto até sexta, horário de atendimento até 19h."}
                                            value={aiObjective}
                                            onValueChange={setAiObjective}
                                            maxLength={1000}
                                            disabled={aiLoading || loading}
                                            onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") generateCopies(); }}
                                            toolbar={
                                                <Button type="button" size="sm" variant="secondary" onClick={generateCopies} disabled={aiLoading || loading} className="ml-auto">
                                                    {aiLoading ? "Gerando..." : "Gerar texto"}
                                                </Button>
                                            }
                                        />
                                        {aiCopies.map((c, i) => (
                                            <div key={i}>
                                            <button
                                                type="button"
                                                onClick={() => setMessage(c)}
                                                className="block w-full border border-border p-3 text-left text-sm whitespace-pre-wrap hover:border-foreground transition-colors"
                                            >
                                                {c}
                                                <span className="kicker mt-2 block">Clique para usar esta versão</span>
                                            </button>
                                            <Button type="button" size="sm" variant="ghost" disabled={loading || variants.length >= 4}
                                                onClick={() => setVariants(vs => [...vs, c])}>Adicionar como outra versão (rodízio)</Button>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="space-y-4 pt-4">
                                        <div className="space-y-2">
                                            <Label>Intervalo: {(delay[0] / 1000).toFixed(1)}s</Label>
                                            <Slider
                                                defaultValue={[2000]}
                                                min={1000}
                                                max={15000}
                                                step={500}
                                                value={delay}
                                                onValueChange={setDelay}
                                                disabled={loading}
                                            />
                                            <p className="text-xs text-muted-foreground">Intervalo entre mensagens (+ aleatório).</p>
                                        </div>

                                        <Button
                                            className="w-full"
                                            onClick={handleSend}
                                            disabled={loading || !sessionId || recipientCount === 0 || (!message.trim() && !mediaUrl)}
                                        >
                                            {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                            {loading ? "Disparando..." : "Iniciar disparo"}
                                        </Button>

                                        <Button
                                            variant="outline"
                                            className="w-full"
                                            onClick={() => setScheduleOpen(true)}
                                            disabled={loading || !sessionId || recipientCount === 0 || (!message.trim() && !mediaUrl)}
                                        >
                                            <Calendar className="mr-2 h-4 w-4" />
                                            Agendar disparo
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                    </>
                )}

                {activeTab === "history" && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <History className="h-5 w-5" />
                                
                                Histórico de disparos
                            </CardTitle>
                            <CardDescription>Histórico dos disparos enviados, armazenado permanentemente.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {historyLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                            ) : history.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground">
                                    <p className="text-sm">Nenhum disparo realizado ainda.</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {history.map(log => (
                                        <div key={log.id}
                                            className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/30 transition-colors"
                                        >
                                            {/* Status icon */}
                                            <div className="shrink-0">
                                                {log.status === "completed" ? (
                                                    log.failed === 0
                                                        ? <CheckCircle2 className="h-8 w-8 text-green-500" />
                                                        : <AlertTriangle className="h-8 w-8 text-yellow-500" />
                                                ) : (
                                                    <Radio className="h-8 w-8 text-zinc-500 animate-pulse" />
                                                )}
                                            </div>

                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">{log.message}</p>
                                                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                                    <span className="flex items-center gap-1">
                                                        <CheckCircle2 className="h-3 w-3 text-green-500" /> {log.sent}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <XCircle className="h-3 w-3 text-red-500" /> {log.failed}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <Calendar className="h-3 w-3" /> {formatTime(log.startedAt)}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* View button */}
                                            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => openDetail(log)}>
                                                <Eye className="h-4 w-4 mr-1" />  Detalhes
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Detail Modal */}
                <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                {selectedLog?.status === "completed"
                                    ? <CheckCircle2 className="h-5 w-5 text-green-500" />
                                    : <Radio className="h-5 w-5 text-zinc-500 animate-pulse" />
                                }
                                
                                Detalhes do disparo
                            </DialogTitle>
                        </DialogHeader>

                        {detailLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : selectedLog ? (
                            <div className="flex flex-col gap-4 overflow-hidden min-h-0">
                                {/* Summary */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                                        <div className="text-xl font-bold text-green-600">{selectedLog.sent}</div>
                                        <div className="text-xs text-muted-foreground">Enviadas</div>
                                    </div>
                                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                                        <div className="text-xl font-bold text-red-500">{selectedLog.failed}</div>
                                        <div className="text-xs text-muted-foreground">Falhas</div>
                                    </div>
                                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                                        <div className="text-xl font-bold">{selectedLog.total}</div>
                                        <div className="text-xs text-muted-foreground">Total</div>
                                    </div>
                                </div>

                                {/* Message */}
                                <div className="bg-muted/30 rounded-lg p-3">
                                    <p className="text-xs text-muted-foreground mb-1">Mensagem:</p>
                                    <p className="text-sm whitespace-pre-wrap break-words">{selectedLog.message}</p>
                                </div>

                                {/* Time */}
                                <div className="flex gap-4 text-xs text-muted-foreground">
                                    <span>Iniciado em: {formatTime(selectedLog.startedAt)}</span>
                                    {selectedLog.completedAt && <span>Concluído em: {formatTime(selectedLog.completedAt)}</span>}
                                </div>

                                {/* Recipients list */}
                                {selectedLog.recipients && selectedLog.recipients.length > 0 && (
                                    <div className="flex-1 overflow-y-auto min-h-0">
                                        <h4 className="text-sm font-semibold mb-2">Destinatários ({selectedLog.recipients.length})</h4>
                                        <div className="space-y-1">
                                            {selectedLog.recipients.map(r => (
                                                <div key={r.id}
                                                    className={`flex items-center justify-between gap-2 text-xs py-1.5 px-2 rounded ${
                                                        r.status === "sent" ? "bg-green-500/5" :
                                                        r.status === "failed" ? "bg-red-500/5" : "bg-muted/30"
                                                    }`}
                                                >
                                                    <span className="font-mono truncate">{formatJid(r.jid)}</span>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <span className={`px-1.5 py-0.5 rounded font-medium ${
                                                            r.status === "sent" ? "text-green-600 bg-green-500/10" :
                                                            r.status === "failed" ? "text-red-500 bg-red-500/10" : "text-muted-foreground bg-muted/50"
                                                        }`}>
                                                            {r.status}
                                                        </span>
                                                        {r.error && (
                                                            <span className="text-red-500 max-w-[200px] truncate" title={r.error}>{r.error}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </DialogContent>
                </Dialog>
            </div>
            <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Agendar disparo</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            A mensagem será enviada para {recipientCount} {recipientCount === 1 ? "número" : "números"} a partir do horário escolhido, um de cada vez, com {(Math.max(3000, delay[0]) / 1000).toFixed(0)} segundos ou mais entre eles.
                            Variáveis como {"{primeironome}"} são trocadas na hora do envio.
                            {variants.some(v => v.trim()) ? " As versões extras do texto saem em rodízio." : ""}{mediaUrl ? " A imagem vai junto, com o texto como legenda." : ""}
                        </p>
                        <div className="space-y-2">
                            <Label htmlFor="schedule-at">Data e hora</Label>
                            <Input id="schedule-at" type="datetime-local" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} />
                        </div>
                        <div className="flex gap-2 justify-end pt-2">
                            <Button variant="ghost" onClick={() => setScheduleOpen(false)} disabled={scheduling}>Cancelar</Button>
                            <Button onClick={handleSchedule} disabled={scheduling || !scheduleAt}>
                                {scheduling ? "Agendando..." : "Agendar"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>


            <Dialog open={riskOpen} onOpenChange={setRiskOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-yellow-500" />Atenção: risco de bloqueio</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 text-sm">
                        <p>Você vai enviar para <strong>{recipientCount}</strong> contatos. Disparos grandes aumentam o risco de o WhatsApp <strong>bloquear o seu número</strong>, principalmente com lista antiga, contatos que nunca falaram com você ou número novo.</p>
                        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                            <li>Prefira clientes que já conversaram com você.</li>
                            <li>Use intervalos maiores e mais de uma versão do texto.</li>
                            <li>Evite enviar de madrugada ou à noite.</li>
                        </ul>
                        <p className="text-muted-foreground">O bloqueio de um número é responsabilidade de quem dispara. Você pode ajustar o ritmo em Configurações do bot.</p>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => setRiskOpen(false)}>Cancelar</Button>
                        <Button onClick={doSend}>Entendi, iniciar disparo</Button>
                    </div>
                </DialogContent>
            </Dialog>
        </SessionGuard>
    );
}
