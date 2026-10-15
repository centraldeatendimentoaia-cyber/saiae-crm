"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, ArrowLeft, ArrowRight, FileJson, ShieldCheck, Info, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { WebhookLog, formatTime, formatJson } from "./webhook-log-utils";
export type LogTab = "payload" | "response" | "headers";

interface LogDetailsProps {
    selectedLog: WebhookLog | null;
    timezone: string;
    showMobileDetails: boolean;
    onBack: () => void;
    activeTab: LogTab;
    onTabChange: (tab: LogTab) => void;
    onCopy: (text: string, message: string) => void;
}

export function LogDetails({ selectedLog, timezone, showMobileDetails, onBack, activeTab, onTabChange, onCopy }: LogDetailsProps) {
    return (
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
                                    onClick={() => onBack()}
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
                                    onClick={() => onCopy(selectedLog.requestUrl, "URL copiada")}
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
                                        onClick={() => onTabChange("payload")}
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
                                        onClick={() => onTabChange("response")}
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
                                        onClick={() => onTabChange("headers")}
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
                                                ? "Payload copiado" 
                                                : activeTab === "response"
                                                    ? "Corpo da resposta copiado"
                                                    : "Cabeçalhos copiados";
                                            onCopy(textToCopy, msg);
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
    );
}
