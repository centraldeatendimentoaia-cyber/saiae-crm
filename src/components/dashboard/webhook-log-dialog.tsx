"use client";

import { TZ_SAO_PAULO } from "@/modules/atendimento-comum/tempo";
import { logger } from "@/lib/logger";
import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { History, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { WebhookLog } from "./webhook-log-utils";
import { LogList } from "./webhook-log-list";
import { LogDetails, type LogTab } from "./webhook-log-details";

interface Props {
    webhookId: string;
    webhookName: string;
    targetSessionId: string;
    open: boolean;
    onClose: () => void;
}

export default function WebhookLogDialog({ webhookId, webhookName, targetSessionId, open, onClose }: Props) {
    const [logs, setLogs] = useState<WebhookLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [meta, setMeta] = useState({ total: 0, offset: 0 });
    const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<LogTab>("payload");
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
                        <LogList
                            logs={logs}
                            selectedLogId={selectedLogId}
                            onSelect={(id) => { setSelectedLogId(id); setShowMobileDetails(true); }}
                            showMobileDetails={showMobileDetails}
                            total={total}
                            shown={shown}
                            hasMore={hasMore}
                            loading={loading}
                            loadingMore={loadingMore}
                            timezone={timezone}
                            onRefresh={fetchLogs}
                            onLoadMore={loadMore}
                        />

                        <LogDetails
                            selectedLog={selectedLog}
                            timezone={timezone}
                            showMobileDetails={showMobileDetails}
                            onBack={() => setShowMobileDetails(false)}
                            activeTab={activeTab}
                            onTabChange={setActiveTab}
                            onCopy={copyToClipboard}
                        />
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
