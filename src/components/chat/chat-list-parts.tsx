"use client";

import { logger } from "@/lib/logger";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MessageCircle, Tag, Info, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface ChatContact {
    jid: string;
    phoneJid?: string;
    name: string | null;
    notify: string | null;
    profilePic: string | null;
    unread?: number;
    lastMessage?: {
        content: string | null;
        timestamp: string;
        type: string;
    };
}

interface LabelData {
    id: string;
    name: string;
    colorHex: string;
}

export interface ChatListProps {
    sessionId: string;
    onSelectChat: (jid: string, name?: string) => void;
    selectedJid?: string;
}

export const PAGE_SIZE = parseInt(process.env.NEXT_PUBLIC_CHAT_PAGE_SIZE || "50", 10);

function getDisplayName(chat: ChatContact): string {
    return chat.name || chat.notify || (chat.phoneJid || chat.jid).split('@')[0];
}

function getMessagePreview(chat: ChatContact): string {
    if (!chat.lastMessage?.content) return "No messages yet";
    const content = chat.lastMessage.content;
    if (chat.lastMessage.type !== "TEXT") {
        return `📎 ${chat.lastMessage.type.charAt(0) + chat.lastMessage.type.slice(1).toLowerCase()}`;
    }
    return content.length > 40 ? content.slice(0, 40) + "…" : content;
}

function getTimeLabel(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ─── Label Assignment Popover ──────
function LabelAssignPopover({ sessionId, jid, children }: { sessionId: string; jid: string; children: React.ReactNode }) {
    const [labels, setLabels] = useState<LabelData[]>([]);
    const [assigned, setAssigned] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const openRef = useRef(false);

    const fetchLabels = useCallback(async () => {
        setLoading(true);
        try {
            const [labelRes, assignedRes] = await Promise.all([
                fetch(`/api/labels/${sessionId}`),
                fetch(`/api/labels/${sessionId}/chats?jid=${encodeURIComponent(jid)}`)
            ]);
            const labelData = await labelRes.json();
            const assignedData = await assignedRes.json();

            if (labelRes.ok) setLabels(labelData.data?.labels || []);
            if (assignedRes.ok) {
                setAssigned(new Set((assignedData.data || []).map((cl: { labelId: string }) => cl.labelId)));
            }
        } catch (e) {
            logger.error("ChatList", "Failed to fetch labels", e);
        } finally {
            setLoading(false);
        }
    }, [sessionId, jid]);

    useEffect(() => {
        if (openRef.current) fetchLabels();
    }, [fetchLabels]);

    const toggleLabel = async (labelId: string) => {
        const isAssigned = assigned.has(labelId);
        try {
            const res = await fetch(`/api/labels/${sessionId}/chat/${encodeURIComponent(jid)}/labels`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ labelIds: [labelId], action: isAssigned ? "remove" : "add" })
            });
            if (res.ok) {
                setAssigned(prev => {
                    const next = new Set(prev);
                    isAssigned ? next.delete(labelId) : next.add(labelId);
                    return next;
                });
                toast.success(isAssigned ? "Label removed" : "Label assigned");
            }
        } catch (e) {
            toast.error("Falha ao atualizar a etiqueta");
        }
    };

    return (
        <Popover onOpenChange={(open) => { openRef.current = open; if (open) fetchLabels(); }}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent className="w-56 p-1.5" side="right" align="start">
                <div className="text-xs font-semibold text-muted-foreground px-2 py-1.5">Atribuir etiquetas</div>
                {loading ? (
                    <div className="flex items-center justify-center py-4"><Skeleton className="h-4 w-24" /></div>
                ) : labels.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-2 py-2">Nenhuma etiqueta. Crie uma na página de Etiquetas.</p>
                ) : (
                    <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                        {labels.map(label => (
                            <button key={label.id} onClick={() => toggleLabel(label.id)}
                                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm hover:bg-muted transition-colors cursor-pointer text-left">
                                <div className={cn(
                                    "h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                                    assigned.has(label.id) ? "border-foreground" : "border-muted-foreground/30"
                                )}>
                                    {assigned.has(label.id) && <Check className="h-2.5 w-2.5" />}
                                </div>
                                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: label.colorHex }} />
                                <span className="truncate text-xs font-medium">{label.name}</span>
                            </button>
                        ))}
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}

// ─── Context Menu ──────────────────
interface CtxMenuState { x: number; y: number; jid: string; name: string; }
function ChatContextMenu({ state, onClose, sessionId, onSelect }: { state: CtxMenuState; onClose: () => void; sessionId: string; onSelect: (jid: string, name?: string) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, [onClose]);

    const items = [
        { label: "Abrir conversa", icon: MessageCircle, action: () => { onSelect(state.jid, state.name); onClose(); } },
        { label: "Copiar JID", icon: Info, action: () => { navigator.clipboard.writeText(state.jid).then(() => toast.success("JID copiado!")); onClose(); } },
    ];

    const style: React.CSSProperties = { position: "fixed", top: state.y, left: state.x, zIndex: 9999 };
    if (state.x > window.innerWidth - 180) style.left = state.x - 180;
    if (state.y > window.innerHeight - 120) style.top = state.y - 120;

    return (
        <div ref={ref} style={style} className="w-44 rounded-xl bg-popover border shadow-xl py-1 animate-in fade-in zoom-in-95 origin-top-left">
            {items.map((item, i) => (
                <button key={i} onClick={item.action} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors cursor-pointer text-foreground hover:bg-muted">
                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                    {item.label}
                </button>
            ))}
        </div>
    );
}

// ─── Chat Row ──────────────────────
export function ChatRow({
    chat, isSelected, onSelect, sessionId, labelDots
}: {
    chat: ChatContact; isSelected: boolean; onSelect: (jid: string, name?: string) => void; sessionId: string;
    labelDots: { colorHex: string }[];
}) {
    const displayName = getDisplayName(chat);
    const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);

    return (
        <>
            {ctxMenu && (
                <ChatContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} sessionId={sessionId} onSelect={onSelect} />
            )}
            <div
                className={cn(
                    "relative w-full flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 border-b border-border/10 group overflow-hidden cursor-pointer",
                    isSelected
                        ? "bg-muted border-l-2 border-l-brand"
                        : "hover:bg-muted/40 border-l-2 border-l-transparent"
                )}
                onClick={() => onSelect(chat.jid, displayName)}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, jid: chat.jid, name: displayName }); }}
            >
                <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarImage src={chat.profilePic || ""} />
                    <AvatarFallback className="text-xs font-medium bg-gradient-to-br from-primary/20 to-zinc-500/20 text-primary">
                        {displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex justify-between items-baseline gap-2 overflow-hidden">
                        <h4 className={cn("text-sm truncate flex items-center gap-1.5", (isSelected || (chat.unread ?? 0) > 0) ? "font-bold text-foreground" : "font-medium text-foreground")}>
                            {displayName}
                            {/* Label dots — always visible */}
                            {labelDots.length > 0 && (
                                <span className="flex items-center gap-[2px] shrink-0">
                                    {labelDots.map((d, i) => (
                                        <span key={i} className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: d.colorHex }} title={d.colorHex} />
                                    ))}
                                </span>
                            )}
                        </h4>
                        {chat.lastMessage && (
                            <span className={cn("text-[11px] flex-shrink-0", (chat.unread ?? 0) > 0 ? "font-bold text-foreground" : "text-muted-foreground")}>{getTimeLabel(chat.lastMessage.timestamp)}</span>
                        )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p className={cn("text-xs truncate", (chat.unread ?? 0) > 0 ? "font-semibold text-foreground" : "text-muted-foreground")}>{getMessagePreview(chat)}</p>
                        {(chat.unread ?? 0) > 0 && (
                            <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-brand text-brand-foreground text-[11px] font-bold flex items-center justify-center tabular-nums" aria-label={`${chat.unread} não lidas`}>
                                {chat.unread! > 99 ? "99+" : chat.unread}
                            </span>
                        )}
                    </div>
                </div>

                {/* Label button on hover */}
                <LabelAssignPopover sessionId={sessionId} jid={chat.jid}>
                    <Button variant="ghost" size="icon"
                        className="h-7 w-7 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
                        onClick={(e) => e.stopPropagation()}>
                        <Tag className="h-3.5 w-3.5" />
                    </Button>
                </LabelAssignPopover>
            </div>
        </>
    );
}

export function SkeletonRow() {
    return (
        <div className="flex items-center gap-3 px-3 py-2.5">
            <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-40" />
            </div>
        </div>
    );
}

// ─── Main ──────────────────────────
