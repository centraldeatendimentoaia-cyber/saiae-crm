"use client";

import { TZ_SAO_PAULO } from "@/modules/atendimento-comum/tempo";
import { logger } from "@/lib/logger";
import { useState, useEffect, useCallback, useRef } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
    History, 
    Loader2, 
    ChevronDown, 
    Copy, 
    RefreshCw, 
    ArrowLeft, 
    ArrowRight, 
    FileJson, 
    ShieldCheck, 
    Info, 
    AlertCircle 
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface WebhookLog {
    id: string;
    webhookId: string;
    event: string;
    status: string;
    requestUrl: string;
    requestHeaders?: unknown;
    requestBody?: unknown;
    responseStatusCode?: number;
    responseBody?: string;
    responseTimeMs?: number;
    errorMessage?: string;
    createdAt: string;
}

interface Props {
    webhookId: string;
    webhookName: string;
    targetSessionId: string;
    open: boolean;
    onClose: () => void;
}

function formatTime(ts: string, tz: string) {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts || "";
    try {
        return d.toLocaleString("pt-BR", { timeZone: tz });
    } catch {
        return d.toLocaleString("pt-BR");
    }
}

function formatTimeOnly(ts: string, tz: string) {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    try {
        return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: tz });
    } catch {
        return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
}

function formatJson(obj: unknown): string {
    try {
        return JSON.stringify(obj, null, 2);
    } catch {
        return String(obj);
    }
}

export default function WebhookLogDialog({ webhookId, webhookName, targetSessionId, open, onClose }: Props) {
    const [logs, setLogs] = useState<WebhookLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [meta, setMeta] = useState({ total: 0, offset: 0 });
    const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"payload" | "response" | "headers">("payload");
    const [showMobileDetails, setShowMobileDetails] = useState(false);
    const [timezone, setTimezone] = useState<string>(TZ_SAO_PAULO);

    // Reset log selection and fetch timezone when dialog changes state
    useEffect(() => {
        if (open) {
            setSelectedLogId(null);
            setShowMobileDetails(false);
            setActiveTab("payload");

            const fetchTimezone = async () => {
                try {
                    const res = await fetch("/api/settings/system");
                    if (res.ok) {
                        const data = await res.json();
                        if (data?.status && data?.data?.timezone) {
                            setTimezone(data.data.timezone);
                        }
                    }
                } catch (e) {
                    logger.error("WebhookLogDialog", "Failed to fetch system timezone", e);
                }
            };
            fetchTimezone();
        }
    }, [open]);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/webhooks/${targetSessionId}/${webhookId}/logs?limit=50&offset=0`);
            if (res.ok) {
                const data = await res.json();
                const fetched = data?.data || [];
                setLogs(fetched);
                setMeta({ total: data.total || 0, offset: 50 });
                // Auto-select the first log if none is selected
                setSelectedLogId(prev => {
                    if (prev && fetched.some((l: WebhookLog) => l.id === prev)) {
                        return prev;
                    }
                    return fetched[0]?.id || null;
                });
            }
        } catch (e) {
            logger.error("WebhookLogDialog", "Failed to fetch logs", e);
        } finally {
            setLoading(false);
        }
    }, [webhookId, targetSessionId]);

    const loadMore = async () => {
        setLoadingMore(true);
        try {
            const res = await fetch(`/api/webhooks/${targetSessionId}/${webhookId}/logs?limit=50&offset=${meta.offset}`);
            if (res.ok) {
                const data = await res.json();
                const newEntries = data?.data || [];
                setLogs(prev => [...prev, ...newEntries]);
                setMeta(prev => ({ total: data.total || prev.total, offset: prev.offset + newEntries.length }));
            }
        } catch (e) {
            logger.error("WebhookLogDialog", "Failed to load more", e);
        } finally {
            setLoadingMore(false);
        }
    };

    // Use a ref to store the latest log ID to prevent stale closures in polling interval
    const latestLogIdRef = useRef<string | null>(null);
    useEffect(() => {
        latestLogIdRef.current = logs[0]?.id || null;
    }, [logs]);

    // Realtime polling
    useEffect(() => {
        if (!open) return;
        fetchLogs();
        
        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/webhooks/${targetSessionId}/${webhookId}/logs?limit=1&offset=0`);
                if (res.ok) {
                    const data = await res.json();
                    const latest = data?.data?.[0];
                    if (latest && latest.id !== latestLogIdRef.current) {
                        // Silent update (without full loading state) to avoid UI flickering/resetting
                        const silentRes = await fetch(`/api/webhooks/${targetSessionId}/${webhookId}/logs?limit=50&offset=0`);
                        if (silentRes.ok) {
                            const silentData = await silentRes.json();
                            const fetched = silentData?.data || [];
                            setLogs(fetched);
                            setMeta({ total: silentData.total || 0, offset: 50 });
                            setSelectedLogId(prev => {
                                if (prev && fetched.some((l: WebhookLog) => l.id === prev)) {
                                    return prev;
                                }
                                return fetched[0]?.id || null;
                            });
                        }
                    }
                }
            } catch { /* silent */ }
        }, 5000);
        return () => clearInterval(interval);
    }, [open, webhookId, targetSessionId, fetchLogs]);

    const copyToClipboard = (text: string, message: string) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        toast.success(message);
    };

    const shown = logs.length;
    const total = meta.total;
    const hasMore = shown < total;

    const selectedLog = logs.find(l => l.id === selectedLogId) || null;

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-5xl sm:max-w-5xl w-[96vw] h-[82vh] max-h-[85vh] flex flex-col p-0 overflow-hidden gap-0 bg-background shadow-2xl border border-zinc-200/80">
                <style dangerouslySetInnerHTML={{ __html: `
                    .custom-scrollbar-light {
                        scrollbar-width: thin;
                        scrollbar-color: rgba(148, 163, 184, 0.4) transparent;
                    }
                    .custom-scrollbar-light::-webkit-scrollbar {
                        width: 6px;
                        height: 6px;
                    }
                    .custom-scrollbar-light::-webkit-scrollbar-track {
                        background: transparent;
                    }
                    .custom-scrollbar-light::-webkit-scrollbar-thumb {
                        background: rgba(148, 163, 184, 0.4);
                        border-radius: 99px;
                    }
                    .custom-scrollbar-light::-webkit-scrollbar-thumb:hover {
                        background: rgba(148, 163, 184, 0.6);
                    }

                    .custom-scrollbar-dark {
                        scrollbar-width: thin;
                        scrollbar-color: rgba(148, 163, 184, 0.3) #0f141c;
                    }
                    .custom-scrollbar-dark::-webkit-scrollbar {
                        width: 6px;
                        height: 6px;
                    }
                    .custom-scrollbar-dark::-webkit-scrollbar-track {
                        background: #0f141c;
                    }
                    .custom-scrollbar-dark::-webkit-scrollbar-thumb {
                        background: rgba(148, 163, 184, 0.3);
                        border-radius: 99px;
                    }
                    .custom-scrollbar-dark::-webkit-scrollbar-thumb:hover {
                        background: rgba(148, 163, 184, 0.5);
                    }
                ` }} />
                <DialogHeader className="p-4 sm:p-5 border-b shrink-0 flex flex-row items-center justify-between bg-zinc-50/20">
                    <div className="space-y-1">
                        <DialogTitle className="flex items-center gap-2.5 text-lg font-bold text-zinc-800">
                            <div className="bg-primary/10 p-1.5 rounded-lg text-primary">
                                <History className="h-4 w-4" />
                            </div>
                            
                            Logs de entrega de webhooks
                        </DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                            {webhookName}  — Monitore payloads de eventos, cabeçalhos de resposta do servidor e latência.
                        </DialogDescription>
                    </div>
                </DialogHeader>

                {loading && logs.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-sm text-muted-foreground gap-3">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        <p className="font-medium text-xs">Carregando logs...</p>
                    </div>
                ) : logs.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-sm text-muted-foreground space-y-3 p-6 text-center">
                        <div className="h-12 w-12 rounded-full bg-zinc-50 border border-zinc-100 flex items-center justify-center text-zinc-400 shadow-sm">
                            <History className="h-5 w-5 opacity-60" />
                        </div>
                        <div className="space-y-1">
                            <p className="font-semibold text-zinc-800 text-sm">Nenhum log de entrega ainda</p>
                            <p className="text-xs text-muted-foreground max-w-[280px]">
                                
                                Os logs aparecerão aqui assim que os webhooks forem disparados ou quando você clicar em "Testar".
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
                        {/* Left Column: Logs List */}
                        <div className={cn(
                            "w-full md:w-[280px] lg:w-[320px] xl:w-[340px] border-r border-zinc-100 flex flex-col min-h-0 bg-zinc-50/20 shrink-0",
                            showMobileDetails ? "hidden md:flex" : "flex"
                        )}>
                            {/* Logs List Subheader */}
                            <div className="p-3 px-4 border-b flex items-center justify-between text-xs text-muted-foreground shrink-0 bg-zinc-100/30">
                                <span className="flex items-center gap-2">
                                    <span className="bg-zinc-200/80 text-zinc-700 px-2 py-0.5 rounded-full font-semibold text-[10px]">
                                        {total} logs
                                    </span>
                                    <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full flex items-center gap-1 font-semibold text-[10px] border border-emerald-100/40">
                                        <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse inline-block" />
                                        
                                        Ao vivo
                                    </span>
                                </span>
                                <div className="flex items-center gap-1.5">
                                    {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
                                        onClick={fetchLogs}
                                        title="Atualizar logs"
                                    >
                                        <RefreshCw className="h-3 w-3" />
                                    </Button>
                                </div>
                            </div>

                            {/* Scroll Container */}
                            <div className="flex-1 overflow-y-auto min-h-0 py-2 bg-zinc-50/10 custom-scrollbar-light">
                                {logs.map((log) => {
                                    const isSelected = log.id === selectedLogId;
                                    const isSuccess = log.status === "SUCCESS";
                                    const isStatusError = log.responseStatusCode && log.responseStatusCode >= 400;

                                    return (
                                        <button
                                            key={log.id}
                                            onClick={() => {
                                                setSelectedLogId(log.id);
                                                setShowMobileDetails(true);
                                            }}
                                            className={cn(
                                                "w-[calc(100%-16px)] mx-2 my-0.5 text-left p-3 rounded-lg transition-all flex flex-col gap-1.5 border border-transparent select-none",
                                                isSelected 
                                                    ? "bg-white shadow-sm border-zinc-200/80 text-zinc-950 font-medium" 
                                                    : "hover:bg-zinc-100/50 text-zinc-700"
                                            )}
                                        >
                                            <div className="flex items-center justify-between gap-2 w-full">
                                                <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-zinc-100/80 border text-zinc-700 truncate max-w-[120px] lg:max-w-[160px]">
                                                    {log.event}
                                                </span>
                                                <span className="text-[10px] text-zinc-400 font-mono">
                                                    {formatTimeOnly(log.createdAt, timezone)}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-2.5 mt-0.5">
                                                <div className="flex items-center gap-1.5">
                                                    <span className={cn(
                                                        "h-2 w-2 rounded-full",
                                                        isSuccess ? "bg-emerald-500" : "bg-rose-500"
                                                    )} />
                                                    <span className={cn(
                                                        "text-[10px] font-semibold uppercase tracking-wider",
                                                        isSuccess ? "text-emerald-600" : "text-rose-600"
                                                    )}>
                                                        {isSuccess ? "Sucesso" : "Falhas"}
                                                    </span>
                                                </div>

                                                {log.responseStatusCode != null && (
                                                    <span className={cn(
                                                        "text-[10px] font-mono font-bold bg-zinc-50 px-1 rounded border",
                                                        isStatusError ? "text-rose-600 border-rose-100" : "text-emerald-600 border-emerald-100"
                                                    )}>
                                                        {log.responseStatusCode}
                                                    </span>
                                                )}

                                                {log.responseTimeMs != null && (
                                                    <span className="text-[10px] text-zinc-400 font-mono ml-auto">
                                                        {log.responseTimeMs}ms
                                                    </span>
                                                )}
                                            </div>

                                            <div className="text-[10px] font-mono text-zinc-400 truncate w-full mt-0.5 opacity-80">
                                                {log.requestUrl}
                                            </div>
                                        </button>
                                    );
                                })}

                                {/* Load more */}
                                {hasMore ? (
                                    <div className="p-3 px-4">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full text-xs hover:bg-zinc-100"
                                            onClick={loadMore}
                                            disabled={loadingMore}
                                        >
                                            {loadingMore ? (
                                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                            ) : (
                                                <ChevronDown className="h-3 w-3 mr-1" />
                                            )}
                                            
                                            Carregar {total - shown}  mais
                                        </Button>
                                    </div>
                                ) : shown > 0 ? (
                                    <div className="p-4 text-[10px] text-center text-zinc-400 bg-transparent font-mono select-none">
                                        
                                        Todos {total}  logs carregados
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        {/* Right Column: Log Details */}
                        <div className={cn(
                            "flex-1 flex flex-col min-h-0 bg-background",
                            !showMobileDetails ? "hidden md:flex" : "flex"
                        )}>
                            {selectedLog ? (
                                <div className="flex-1 flex flex-col min-h-0">
                                    {/* Details Subheader */}
                                    <div className="p-4 px-5 border-b flex flex-col gap-3 bg-zinc-50/10 shrink-0">
                                        {/* Row 1: Back Button & Badges */}
                                        <div className="flex items-center justify-between gap-2.5 flex-wrap">
                                            {/* Mobile Back Button */}
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="md:hidden -ml-2 h-7 px-2 text-xs flex items-center gap-1 text-zinc-600 hover:text-zinc-900"
                                                onClick={() => setShowMobileDetails(false)}
                                            >
                                                <ArrowLeft className="h-4 w-4" />
                                                
                                                Voltar
                                            </Button>

                                            <div className="flex flex-wrap items-center gap-2 text-xs">
                                                <span className="font-semibold font-mono bg-zinc-100 border px-2 py-0.5 rounded text-zinc-700 shadow-sm">
                                                    {selectedLog.event}
                                                </span>

                                                <Badge
                                                    variant={selectedLog.status === "SUCCESS" ? "default" : "destructive"}
                                                    className={cn(
                                                        "px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                                                        selectedLog.status === "SUCCESS" ? "bg-emerald-600 hover:bg-emerald-600 text-white" : ""
                                                    )}
                                                >
                                                    {selectedLog.status}
                                                </Badge>

                                                {selectedLog.responseStatusCode != null && (
                                                    <span className={cn(
                                                        "font-bold font-mono text-xs bg-zinc-50 px-1.5 py-0.5 rounded border shadow-inner",
                                                        selectedLog.responseStatusCode >= 400 ? "text-rose-600 border-rose-100/50" : "text-emerald-600 border-emerald-100/50"
                                                    )}>
                                                        {selectedLog.responseStatusCode}
                                                    </span>
                                                )}

                                                {selectedLog.responseTimeMs != null && (
                                                    <span className="text-zinc-500 text-xs font-mono">
                                                        ({selectedLog.responseTimeMs}ms de latência)
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Row 2: URL bar (Full width, wraps long URLs cleanly but capped to max height with internal scrollbar) */}
                                        <div className="flex items-start gap-2.5 bg-zinc-50 border border-zinc-200/80 py-1.5 px-3 rounded-lg w-full shadow-inner">
                                            <span className="text-[9px] font-bold text-zinc-500 select-none bg-zinc-200/60 px-1.5 py-0.5 rounded mt-0.5 shrink-0">
                                                POST
                                            </span>
                                            <div className="text-[11px] font-mono text-zinc-600 break-all select-all flex-1 leading-relaxed max-h-[50px] overflow-y-auto custom-scrollbar-light pr-1">
                                                {selectedLog.requestUrl}
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-5 w-5 text-zinc-400 hover:text-zinc-800 shrink-0 mt-0.5"
                                                onClick={() => copyToClipboard(selectedLog.requestUrl, "URL copied to clipboard")}
                                            >
                                                <Copy className="h-3 w-3" />
                                            </Button>
                                        </div>

                                        {/* Row 3: Attempted timestamp and Log ID (Self-wrapping secondary text) */}
                                        <div className="text-[10px] text-zinc-400 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono">
                                            <div className="flex items-center gap-1.5">
                                                <Info className="h-3.5 w-3.5 text-zinc-400/80" />
                                                <span>Tentativa em:</span>
                                                <span className="font-semibold text-zinc-600">{formatTime(selectedLog.createdAt, timezone)}</span>
                                            </div>
                                            <span className="text-zinc-300 hidden sm:inline select-none">•</span>
                                            <div className="flex items-center gap-1">
                                                <span>ID:</span>
                                                <span className="font-semibold text-zinc-600 select-all">{selectedLog.id}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Error Message banner */}
                                    {selectedLog.errorMessage && (
                                        <div className="mx-5 mt-3 p-3.5 bg-rose-50/50 border border-rose-100 text-rose-800 text-xs rounded-xl flex items-start gap-2.5">
                                            <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                                            <div className="space-y-1">
                                                <p className="font-semibold text-rose-900 text-xs">Falha na entrega</p>
                                                <p className="font-mono break-all text-[11px] leading-relaxed">{selectedLog.errorMessage}</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Tabs (Segmented Control style) */}
                                    <div className="flex-1 flex flex-col min-h-0">
                                        <div className="flex border-b shrink-0 px-5 py-2.5 bg-zinc-50/20 items-center justify-between">
                                            <div className="bg-zinc-100 p-0.5 rounded-lg flex gap-0.5 text-xs">
                                                <button
                                                    onClick={() => setActiveTab("payload")}
                                                    className={cn(
                                                        "px-3.5 py-1 rounded-md transition-all flex items-center gap-1.5 font-medium",
                                                        activeTab === "payload"
                                                            ? "bg-white shadow-sm text-zinc-900 font-semibold"
                                                            : "text-zinc-500 hover:text-zinc-900"
                                                    )}
                                                >
                                                    <FileJson className="h-3.5 w-3.5" />
                                                    Payload
                                                </button>
                                                <button
                                                    onClick={() => setActiveTab("response")}
                                                    className={cn(
                                                        "px-3.5 py-1 rounded-md transition-all flex items-center gap-1.5 font-medium",
                                                        activeTab === "response"
                                                            ? "bg-white shadow-sm text-zinc-900 font-semibold"
                                                            : "text-zinc-500 hover:text-zinc-900"
                                                    )}
                                                >
                                                    <ArrowRight className="h-3.5 w-3.5" />
                                                    
                                                    Resposta
                                                </button>
                                                <button
                                                    onClick={() => setActiveTab("headers")}
                                                    className={cn(
                                                        "px-3.5 py-1 rounded-md transition-all flex items-center gap-1.5 font-medium",
                                                        activeTab === "headers"
                                                            ? "bg-white shadow-sm text-zinc-900 font-semibold"
                                                            : "text-zinc-500 hover:text-zinc-900"
                                                    )}
                                                >
                                                    <ShieldCheck className="h-3.5 w-3.5" />
                                                    
                                                    Cabeçalhos
                                                </button>
                                            </div>
                                        </div>

                                        {/* Tab contents - Full bleed premium editor */}
                                        <div className="flex-1 min-h-0 bg-[#0f141c] text-zinc-100 relative flex flex-col border-t border-zinc-800">
                                            {/* Code Editor Header */}
                                            <div className="bg-[#161c24] text-[10px] text-zinc-400 font-semibold py-2 px-4 select-none flex items-center justify-between border-b border-zinc-800 shrink-0">
                                                <span className="font-mono tracking-wide text-zinc-350">
                                                    {activeTab === "payload" ? "payload.json" : activeTab === "response" ? "response.txt" : "headers.json"}
                                                </span>
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    className="h-5.5 px-2 py-0 text-[10px] bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/50 hover:border-zinc-600 transition-all font-mono"
                                                    onClick={() => {
                                                        const textToCopy = activeTab === "payload" 
                                                            ? formatJson(selectedLog.requestBody)
                                                            : activeTab === "response"
                                                                ? selectedLog.responseBody || ""
                                                                : formatJson(selectedLog.requestHeaders);
                                                        const msg = activeTab === "payload" 
                                                            ? "Payload copied" 
                                                            : activeTab === "response"
                                                                ? "Response body copied"
                                                                : "Headers copied";
                                                        copyToClipboard(textToCopy, msg);
                                                    }}
                                                >
                                                    <Copy className="h-3 w-3 mr-1" />
                                                    
                                                    Copiar
                                                </Button>
                                            </div>
                                            
                                            {/* Code Box Scrolling */}
                                            <div className="flex-1 overflow-auto p-5 select-text custom-scrollbar-dark">
                                                <pre className="font-mono text-xs text-zinc-300 leading-relaxed select-text py-1 whitespace-pre-wrap break-all">
                                                    {activeTab === "payload" && (selectedLog.requestBody ? formatJson(selectedLog.requestBody) : "{}")}
                                                    {activeTab === "response" && (selectedLog.responseBody || "O servidor não retornou corpo de resposta.")}
                                                    {activeTab === "headers" && (selectedLog.requestHeaders ? formatJson(selectedLog.requestHeaders) : "{}")}
                                                </pre>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-6 text-center space-y-3 bg-zinc-50/10">
                                    <div className="h-12 w-12 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-400">
                                        <FileJson className="h-6 w-6" />
                                    </div>
                                    <div className="max-w-[280px]">
                                        <h4 className="text-sm font-semibold text-zinc-800">Nenhum log selecionado</h4>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            
                                            Selecione uma tentativa de webhook na barra lateral para ver os metadados e payloads detalhados.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
