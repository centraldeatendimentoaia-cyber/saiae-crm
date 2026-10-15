"use client";

import { useEffect, useRef, useState } from "react";
import { Video, CornerUpLeft, Copy, Trash2, Info, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface Message {
    id: string;
    keyId: string;
    content: string;
    fromMe: boolean;
    timestamp: string;
    type: string;
    status: string;
    pushName?: string;
    mediaUrl?: string;
    remoteJid?: string;
    quoteId?: string | null;
    quoted?: {
        keyId: string;
        content: string | null;
        fromMe: boolean;
        senderJid: string | null;
        pushName: string | null;
    } | null;
}

export interface ChatWindowProps {
    sessionId: string;
    jid: string;
    name?: string;
    onBack?: () => void;
}

export const PAGE_LIMIT = 50;

// ─── Lazy media (unchanged) ────────
export function LazyMedia({ src, alt }: { src: string; alt: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { rootMargin: "200px" });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);
    return (
        <div ref={ref} className="mb-1.5 overflow-hidden rounded-xl">
            {visible ? <img src={src} alt={alt} className={`max-w-full max-h-60 object-cover rounded-xl transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`} onLoad={() => setLoaded(true)} loading="lazy" />
                : <div className="h-40 bg-muted/30 rounded-xl animate-pulse" />}
        </div>
    );
}
export function LazyVideo({ src }: { src: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { rootMargin: "200px" });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);
    return (
        <div ref={ref} className="mb-1.5 overflow-hidden rounded-xl">
            {visible ? <video src={src} controls className="max-w-full max-h-60 rounded-xl" preload="none" />
                : <div className="h-32 bg-muted/30 rounded-xl animate-pulse flex items-center justify-center"><Video className="h-6 w-6 text-muted-foreground/50" /></div>}
        </div>
    );
}

export function useDateLabel() {
    const cache = useRef(new Map<string, string>());
    return (timestamp: string): string => {
        const cached = cache.current.get(timestamp);
        if (cached) return cached;
        const date = new Date(timestamp);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
        let label: string;
        if (diffDays === 0) label = "Today";
        else if (diffDays === 1) label = "Yesterday";
        else label = date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
        cache.current.set(timestamp, label);
        return label;
    };
}

export function handleDownload(url: string, fileName: string) {
    toast.info("Baixando...");
    fetch(url).then(res => { if (!res.ok) throw new Error(); return res.blob(); }).then(blob => {
        const dlUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = dlUrl; link.download = fileName;
        document.body.appendChild(link);
        link.click(); link.remove();
        window.URL.revokeObjectURL(dlUrl);
    }).catch(() => toast.error("Falha no download!"));
}

// ─── Context Menu ──────────────────
export interface ContextMenuState {
    x: number;
    y: number;
    msg: Message;
}
export function ContextMenu({ state, onClose, onReply, onDelete }: { state: ContextMenuState; onClose: () => void; onReply: (msg: Message) => void; onDelete: (msg: Message) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [onClose]);

    const items = [
        { label: "Responder", icon: CornerUpLeft, action: () => { onReply(state.msg); onClose(); } },
        { label: "Copiar", icon: Copy, action: () => { navigator.clipboard.writeText(state.msg.content || "").then(() => toast.success("Copiado!")).catch(() => {}); onClose(); } },
        { label: "Excluir", icon: Trash2, action: () => { onDelete(state.msg); onClose(); }, dangerous: true },
        { label: "Informação", icon: Info, action: () => { toast.info(`ID: ${state.msg.keyId}\nStatus: ${state.msg.status}\nTime: ${new Date(state.msg.timestamp).toLocaleString()}`); onClose(); } },
    ];

    // Adjust position to not overflow viewport
    const style: React.CSSProperties = { position: "fixed", top: state.y, left: state.x, zIndex: 9999 };
    if (state.x > window.innerWidth - 180) style.left = state.x - 180;
    if (state.y > window.innerHeight - 200) style.top = state.y - 180;

    return (
        <div ref={ref} style={style} className="w-44 rounded-xl bg-popover border shadow-xl py-1 animate-in fade-in zoom-in-95 origin-top-left">
            {items.map((item, i) => (
                <button key={i} onClick={item.action} className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors cursor-pointer",
                    item.dangerous ? "text-red-500 hover:bg-red-500/10" : "text-foreground hover:bg-muted"
                )}>
                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                    {item.label}
                </button>
            ))}
        </div>
    );
}

// ─── Main Component ─────────────────

/** Uma mensagem da conversa (com o separador de data quando `dateLabel` vem preenchido). */
export function MessageRow({ msg, dateLabel, isGroup, onReply, onContextMenu }: {
    msg: Message;
    dateLabel: string | null;
    isGroup: boolean;
    onReply: (msg: Message) => void;
    onContextMenu: (e: React.MouseEvent, msg: Message) => void;
}) {
    return (
        <div id={`msg-${msg.keyId}`}>
            {dateLabel && (
                <div className="flex justify-center my-3">
                    <span className="text-[10px] font-medium text-muted-foreground bg-background/80 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm border border-border/30">
                        {dateLabel}
                    </span>
                </div>
            )}
            <div className={cn("flex gap-1 group", msg.fromMe ? "justify-end" : "justify-start")}>
                {/* Reply button: my msg on left */}
                {msg.fromMe && (
                    <button onClick={() => onReply(msg)}
                        className="self-center p-1.5 text-muted-foreground/40 hover:text-amber-500 hover:bg-amber-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 cursor-pointer shrink-0 order-first"
                        title="Responder">
                        <CornerUpLeft className="h-3.5 w-3.5" />
                    </button>
                )}
                <div className={cn(
                    "flex flex-col max-w-[85%] sm:max-w-[70%] rounded-2xl px-3 py-2 shadow-sm overflow-hidden cursor-context-menu",
                    msg.fromMe ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-background border border-border/40 rounded-bl-sm"
                )} onContextMenu={(e) => onContextMenu(e, msg)}>
                    {!msg.fromMe && isGroup && msg.pushName && (
                        <span className="text-[10px] font-semibold text-primary block mb-0.5">{msg.pushName}</span>
                    )}
                    {msg.quoted && (
                        <div 
                            className={cn(
                                "mb-1.5 px-2 py-1 rounded-lg border-l-4 text-xs select-none cursor-pointer text-left bg-muted/40",
                                msg.fromMe 
                                    ? "border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground/90 hover:bg-primary-foreground/15" 
                                    : "border-primary bg-muted text-muted-foreground hover:bg-muted/60"
                            )}
                            onClick={(e) => {
                                e.stopPropagation();
                                const target = document.getElementById(`msg-${msg.quoted?.keyId}`);
                                if (target) {
                                    target.scrollIntoView({ behavior: "smooth", block: "center" });
                                    target.classList.add("bg-primary/10", "transition-colors", "duration-500");
                                    setTimeout(() => {
                                        target.classList.remove("bg-primary/10");
                                    }, 1500);
                                } else {
                                    toast.info("Mensagem original não carregada");
                                }
                            }}
                        >
                            <span className="font-semibold block text-[10px]">
                                {msg.quoted.fromMe ? "Você" : (msg.quoted.pushName || msg.quoted.senderJid?.split('@')[0] || "Contato")}
                            </span>
                            <span className="line-clamp-2 block break-all text-xs">
                                {msg.quoted.content || "Mídia"}
                            </span>
                        </div>
                    )}
                    {/* IMAGE */}
                    {msg.type === 'IMAGE' && msg.mediaUrl && (
                        <div className="relative group/media">
                            <LazyMedia src={msg.mediaUrl} alt="Imagem" />
                            <Button size="icon" variant="secondary" className="absolute top-2 right-2 h-8 w-8 rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm"
                                onClick={() => handleDownload(msg.mediaUrl!, `IMAGE-${msg.keyId}.jpg`)}><Download className="h-4 w-4" /></Button>
                        </div>
                    )}
                    {/* VIDEO */}
                    {msg.type === 'VIDEO' && msg.mediaUrl && (
                        <div className="relative group/media">
                            <LazyVideo src={msg.mediaUrl} />
                            <Button size="icon" variant="secondary" className="absolute top-2 right-2 h-8 w-8 rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm z-10"
                                onClick={() => handleDownload(msg.mediaUrl!, `VIDEO-${msg.keyId}.mp4`)}><Download className="h-4 w-4" /></Button>
                        </div>
                    )}
                    {/* AUDIO */}
                    {msg.type === 'AUDIO' && msg.mediaUrl && (
                        <div className="flex items-center gap-2 mb-1.5">
                            <audio src={msg.mediaUrl} controls className="h-8 max-w-[200px]" preload="none" />
                            <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={() => handleDownload(msg.mediaUrl!, `AUDIO-${msg.keyId}.mp3`)}><Download className="h-3.5 w-3.5" /></Button>
                        </div>
                    )}
                    {/* STICKER */}
                    {msg.type === 'STICKER' && msg.mediaUrl && (
                        <div className="relative group/media mb-1">
                            <img src={msg.mediaUrl} alt="Figurinha" className="max-h-32 object-contain rounded-lg" loading="lazy" />
                            <Button size="icon" variant="secondary" className="absolute -top-1 -right-1 h-6 w-6 rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm"
                                onClick={() => handleDownload(msg.mediaUrl!, `STICKER-${msg.keyId}.webp`)}><Download className="h-3 w-3" /></Button>
                        </div>
                    )}
                    {/* DOCUMENT */}
                    {msg.type !== 'TEXT' && msg.type !== 'IMAGE' && msg.type !== 'STICKER' && msg.type !== 'VIDEO' && msg.type !== 'AUDIO' && (
                        <div className={cn("flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg mb-1", msg.fromMe ? "bg-white/15" : "bg-muted/50")}>
                            <div className="flex items-center gap-2 truncate min-w-0">
                                <FileText className="h-3.5 w-3.5 shrink-0" />
                                <span className="text-xs font-medium truncate">{msg.type}  Mensagem</span>
                            </div>
                            {msg.mediaUrl && <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full shrink-0" onClick={() => handleDownload(msg.mediaUrl!, `${msg.type}-${msg.keyId}`)}><Download className="h-3.5 w-3.5" /></Button>}
                        </div>
                    )}
                    {/* Text */}
                    <div className="flex items-end gap-2">
                        <span className="flex-1 text-sm break-all whitespace-pre-wrap">{msg.content}</span>
                        <span className={cn("text-[9px] shrink-0 leading-none", msg.fromMe ? "text-primary-foreground/60" : "text-muted-foreground")}>
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                </div>
                {/* Reply button: other msg on right */}
                {!msg.fromMe && (
                    <button onClick={() => onReply(msg)}
                        className="self-center p-1.5 text-muted-foreground/40 hover:text-amber-500 hover:bg-amber-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"
                        title="Responder">
                        <CornerUpLeft className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
        </div>
    );
}
