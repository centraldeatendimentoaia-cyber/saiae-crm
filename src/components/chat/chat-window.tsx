"use client";

import { errorMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Send, Paperclip, ArrowLeft, FileText, Image as ImageIcon, Music, Video, ArrowDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { getChatMessages, sendChatMessage, sendMediaMessage } from "@/app/dashboard/chat/actions";
import { useSocket } from "./socket-context";
import { Message, ChatWindowProps, ContextMenuState, PAGE_LIMIT, useDateLabel, ContextMenu, MessageRow } from "./chat-window-parts";

export function ChatWindow({ sessionId, jid, name, onBack }: ChatWindowProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const [uploadType, setUploadType] = useState<string>("image");
    const [isDragging, setIsDragging] = useState(false);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [oldestTimestamp, setOldestTimestamp] = useState<string | null>(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const [newMsgBadge, setNewMsgBadge] = useState(false);

    // Delete confirmation
    const [deleteConfirmMsg, setDeleteConfirmMsg] = useState<Message | null>(null);

    // Reply state
    const [replyingTo, setReplyingTo] = useState<Message | null>(null);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

    const { getSocket, joinSession } = useSocket();
    const getDateLabel = useDateLabel();

    const scrollToBottom = useCallback((smooth = true) => {
        bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
    }, []);

    const fetchMessages = useCallback(async (before?: string) => {
        try {
            if (!before) setLoading(true);
            else setLoadingMore(true);
            // o Message local é mais estreito que o do banco (campos nulos viram undefined na tela)
            const data = (await getChatMessages(sessionId, jid, PAGE_LIMIT, before)) as unknown as { messages: Message[]; hasMore: boolean };
            if (!before) { setMessages(data.messages || []); setAutoScroll(true); }
            else if (data.messages?.length > 0) setMessages(prev => [...(data.messages || []), ...prev]);
            setHasMore(data.hasMore);
            if (data.messages?.length > 0) setOldestTimestamp(data.messages[0].timestamp);
        } catch (e) { logger.error("ChatWindow", "Failed to load messages", e); }
        finally { setLoading(false); setLoadingMore(false); }
    }, [sessionId, jid]);

    useEffect(() => { setMessages([]); setOldestTimestamp(null); setHasMore(false); fetchMessages(); }, [fetchMessages]);

    // Auto focus input when chat changes and finished loading
    useEffect(() => {
        if (!loading && inputRef.current) {
            // A tiny delay ensures React has fully flushed the DOM for the new chat
            setTimeout(() => {
                inputRef.current?.focus();
            }, 10);
        }
    }, [jid, loading]);

    // Socket real-time
    useEffect(() => {
        const socket = getSocket();
        if (!socket) return;
        const onConnect = () => joinSession(sessionId);
        if (socket.connected) joinSession(sessionId);
        socket.on("connect", onConnect);
        const normalizedJid = jid.endsWith("@c.us") ? jid.replace("@c.us", "@s.whatsapp.net") : jid;
        const handler = (newMessages: Message[]) => {
            setMessages(prev => {
                const relevant = newMessages.filter(m => m.remoteJid === normalizedJid || prev.some(p => p.remoteJid === m.remoteJid));
                if (relevant.length === 0) return prev;
                const combined = [...prev, ...relevant];
                const unique = Array.from(new Map(combined.map(m => [m.keyId, m])).values());
                return unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            });
        };
        socket.on("message.update", handler);
        return () => { socket.off("connect", onConnect); socket.off("message.update", handler); };
    }, [sessionId, jid, getSocket, joinSession]);

    useEffect(() => { if (autoScroll) scrollToBottom(false); }, [messages, autoScroll, scrollToBottom]);

    const handleScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        setAutoScroll(atBottom);
        if (atBottom) setNewMsgBadge(false);
        if (el.scrollTop < 100 && hasMore && !loadingMore && oldestTimestamp) {
            const prevHeight = el.scrollHeight;
            fetchMessages(oldestTimestamp).then(() => {
                requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight; });
            });
        }
    }, [hasMore, loadingMore, oldestTimestamp, fetchMessages]);

    const handleSend = async () => {
        if (!input.trim()) return;
        try {
            await sendChatMessage(sessionId, jid, input, replyingTo?.keyId);
            setInput("");
            setReplyingTo(null);
            setTimeout(() => fetchMessages(), 800);
        } catch (e) { toast.error(errorMessage(e, "Falha ao enviar")); }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    // Focus input when replying
    useEffect(() => {
        if (replyingTo && inputRef.current) {
            inputRef.current.focus();
        }
    }, [replyingTo]);

    // Global keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Escape: cancel reply
            if (e.key === "Escape" && replyingTo) {
                e.preventDefault();
                setReplyingTo(null);
                return;
            }
            // ? : show shortcuts
            if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
                toast.success("Atalhos", {
                    description: "Enter: enviar Shift+Enter: nova linha Esc: cancelar resposta ?: mostrar esta ajuda"
                });
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [replyingTo]);

    const processFileUpload = async (file: File, explicitType?: string) => {
        const formData = new FormData();
        formData.append("file", file);
        let type = explicitType;
        if (!type || type === '*') {
            if (file.type.startsWith('image/')) type = 'image';
            else if (file.type.startsWith('video/')) type = 'video';
            else if (file.type.startsWith('audio/')) type = 'audio';
            else type = 'document';
        }
        formData.append("type", type);
        formData.append("sessionId", sessionId);
        formData.append("jid", jid);
        try {
            toast.info(`Sending ${file.name}...`);
            await sendMediaMessage(formData);
            toast.success("Enviado!");
            setTimeout(() => fetchMessages(), 800);
        } catch (error) { toast.error(errorMessage(error, "Falha ao enviar a mídia")); }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        await processFileUpload(file, uploadType);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const triggerUpload = (type: string) => {
        setUploadType(type);
        if (fileInputRef.current) {
            fileInputRef.current.accept = type === 'image' ? "image/*" : type === 'video' ? "video/*" : type === 'audio' ? "audio/*" : "*/*";
            fileInputRef.current.click();
        }
    };

    // Right-click handler
    const handleContextMenu = useCallback((e: React.MouseEvent, msg: Message) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, msg });
    }, []);

    const displayName = name || jid.split('@')[0];

    // Loading is now handled gracefully inside the message list to prevent unmounting the layout

    return (
        <div
            className="flex-1 flex flex-col bg-muted/20 min-w-0 min-h-0 relative"
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
                e.preventDefault(); setIsDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) processFileUpload(f);
            }}
        >
            {/* Context menu */}
            {contextMenu && (
                <ContextMenu
                    state={contextMenu}
                    onClose={() => setContextMenu(null)}
                    onReply={(msg) => { setReplyingTo(msg); scrollToBottom(true); }}
                    onDelete={(msg) => {
                        setDeleteConfirmMsg(msg);
                    }}
                />
            )}

            {/* Drag overlay */}
            {isDragging && (
                <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary flex items-center justify-center flex-col gap-3 rounded-lg m-2">
                    <Paperclip className="h-8 w-8 text-primary" />
                    <p className="text-lg font-semibold text-primary">Solte os arquivos aqui</p>
                </div>
            )}

            {/* Delete confirmation dialog */}
            <AlertDialog open={!!deleteConfirmMsg} onOpenChange={(open) => { if (!open) setDeleteConfirmMsg(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir mensagem?</AlertDialogTitle>
                        <AlertDialogDescription>
                            
                            Isso apagará a mensagem para todos. Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                const msg = deleteConfirmMsg;
                                if (!msg) return;
                                fetch(`/api/messages/${sessionId}/${jid}/${msg.keyId}`, { method: "DELETE" })
                                    .then(() => { setMessages(p => p.filter(m => m.keyId !== msg.keyId)); toast.success("Excluída"); })
                                    .catch(() => toast.error("Falha ao excluir"));
                                setDeleteConfirmMsg(null);
                            }}
                        >Excluir</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Loading older indicator */}
            {loadingMore && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 bg-background/80 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm border text-xs flex items-center gap-2">
                    <div className="h-3 w-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    
                    Carregando mensagens antigas...
                </div>
            )}

            {/* Header */}
            <div className="shrink-0 px-3 py-2.5 border-b bg-background/80 backdrop-blur-sm flex items-center gap-3 z-10">
                {onBack && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden shrink-0 text-muted-foreground hover:text-foreground" onClick={onBack}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                )}
                <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback className="text-xs font-medium bg-gradient-to-br from-primary/20 to-zinc-500/20 text-primary">
                        {displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground truncate">{displayName}</h3>
                    <p className="text-[10px] text-muted-foreground truncate">{jid}</p>
                </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 min-h-0 styled-scrollbar" onScroll={handleScroll}
                style={{ backgroundImage: `radial-gradient(circle at 1px 1px, hsl(var(--muted-foreground) / 0.04) 1px, transparent 0)`, backgroundSize: '24px 24px' }}
            >
                <div className="flex flex-col gap-3 max-w-3xl mx-auto">
                    {loading && messages.length === 0 && (
                        <div className="flex-1 flex items-center justify-center py-32">
                            <div className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        </div>
                    )}
                    {!hasMore && messages.length > 0 && (
                        <div className="text-center py-4">
                            <span className="text-[10px] font-medium text-muted-foreground bg-background/80 px-3 py-1 rounded-full border border-border/30">Início da conversa</span>
                        </div>
                    )}
                    {messages.length === 0 && !loading && (
                        <div className="flex-1 flex items-center justify-center py-16"><p className="text-sm text-muted-foreground">Nenhuma mensagem ainda</p></div>
                    )}
                    {messages.map((msg, idx) => (
                        <MessageRow
                            key={msg.keyId}
                            msg={msg}
                            dateLabel={idx === 0 || getDateLabel(msg.timestamp) !== getDateLabel(messages[idx - 1].timestamp) ? getDateLabel(msg.timestamp) : null}
                            isGroup={jid.endsWith("@g.us")}
                            onReply={(m) => { setReplyingTo(m); scrollToBottom(true); }}
                            onContextMenu={handleContextMenu}
                        />
                    ))}
                    <div ref={bottomRef} />
                </div>
            </div>

            {/* New message badge */}
            {newMsgBadge && (
                <button onClick={() => { scrollToBottom(true); setNewMsgBadge(false); }}
                    className="absolute bottom-[90px] right-6 z-20 flex items-center gap-2 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 transition-all animate-bounce">
                    <ArrowDown className="h-4 w-4" />  Novas mensagens
                </button>
            )}

            {/* Input */}
            <div className="shrink-0 px-3 py-2.5 bg-background/80 backdrop-blur-sm border-t">
                <div className="flex items-center gap-2 max-w-3xl mx-auto">
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full shrink-0 text-muted-foreground hover:text-foreground"><Paperclip className="h-4.5 w-4.5" /></Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-44 p-1.5" side="top" align="start">
                            <div className="flex flex-col gap-0.5">
                                <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('image')}><ImageIcon className="h-3.5 w-3.5 text-zinc-500" />  Imagem</Button>
                                <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('video')}><Video className="h-3.5 w-3.5 text-zinc-500" />  Vídeo</Button>
                                <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('audio')}><Music className="h-3.5 w-3.5 text-orange-500" />  Áudio</Button>
                                <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('document')}><FileText className="h-3.5 w-3.5 text-emerald-500" />  Documento</Button>
                            </div>
                        </PopoverContent>
                    </Popover>

                    <div className="flex-1">
                        {/* Reply preview bar */}
                        {replyingTo && (
                            <div className="mb-2 flex items-start gap-2 px-2 py-1.5 rounded-lg bg-muted/50 border-l-2 border-amber-500 text-xs animate-in slide-in-from-bottom-1 overflow-hidden">
                                <div className="flex-1 min-w-0 overflow-hidden">
                                    <span className="font-semibold text-amber-500 block text-[10px]">Respondendo a {replyingTo.fromMe ? "você" : (replyingTo.pushName || jid.split('@')[0])}</span>
                                    <span className="text-muted-foreground truncate block w-full">{replyingTo.content || `[${replyingTo.type}]`}</span>
                                </div>
                                <button onClick={() => setReplyingTo(null)} className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"><X className="h-3 w-3" /></button>
                            </div>
                        )}
                        <div className="flex items-end gap-2 p-1 rounded-2xl border border-border/30 bg-background">
                            <textarea ref={inputRef} value={input} onChange={(e) => { setInput(e.target.value); const el = e.target; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px"; }}
                                onKeyDown={handleKeyDown} placeholder="Digite uma mensagem..." rows={1} style={{ minHeight: "36px", maxHeight: "120px" }}
                                className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none leading-normal" />
                        </div>
                    </div>

                    <Button onClick={handleSend} disabled={!input.trim()} size="icon" className="h-9 w-9 rounded-full shrink-0"><Send className="h-4 w-4" /></Button>
                </div>
            </div>
        </div>
    );
}
