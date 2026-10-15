"use client";

import { Button } from "@/components/ui/button";
import { Loader2, ChevronDown, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { WebhookLog, formatTimeOnly } from "./webhook-log-utils";
interface LogListProps {
    logs: WebhookLog[];
    selectedLogId: string | null;
    onSelect: (logId: string) => void;
    showMobileDetails: boolean;
    total: number;
    shown: number;
    hasMore: boolean;
    loading: boolean;
    loadingMore: boolean;
    timezone: string;
    onRefresh: () => void;
    onLoadMore: () => void;
}

export function LogList({ logs, selectedLogId, onSelect, showMobileDetails, total, shown, hasMore, loading, loadingMore, timezone, onRefresh, onLoadMore }: LogListProps) {
    return (
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
                            onClick={onRefresh}
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
                                    onSelect(log.id);
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
                                onClick={onLoadMore}
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
    );
}
