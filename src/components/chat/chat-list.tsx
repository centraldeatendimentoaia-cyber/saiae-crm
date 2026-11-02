"use client";

import { logger } from "@/lib/logger";
import { useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageSquarePlus, Search, MessageCircle, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getChatsStatus, markChatRead } from "@/app/dashboard/chat/actions";
import { useSocket } from "./socket-context";
import { jidDoTelefone } from "@/lib/telefone-br";
import { ChatContact, ChatListProps, PAGE_SIZE, ChatRow, SkeletonRow } from "./chat-list-parts";

/** Mensagem recebida pelo socket (evento de novas mensagens). */
interface IncomingMessage {
    remoteJid: string;
    fromMe: boolean;
    content: string | null;
    timestamp: string;
    type: string;
}

export function ChatList({ sessionId, onSelectChat, selectedJid }: ChatListProps) {
    const [chats, setChats] = useState<ChatContact[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchInput, setSearchInput] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [isNewChatOpen, setIsNewChatOpen] = useState(false);
    const [newChatNumber, setNewChatNumber] = useState("");
    const [hasMore, setHasMore] = useState(true);
    // Label dots per JID — {colorHex}[]
    const [chatLabelMap, setChatLabelMap] = useState<Map<string, {colorHex: string}[]>>(new Map());

    const { getSocket, joinSession } = useSocket();
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cursorRef = useRef<string | undefined>(undefined);
    const chatsRef = useRef<ChatContact[]>(chats);
    chatsRef.current = chats;
    const fetchingRef = useRef(false);
    const recarregarRef = useRef<(() => void) | null>(null);
    const recarregarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const selectedJidRef = useRef<string | undefined>(selectedJid);
    selectedJidRef.current = selectedJid;

    // Abrir uma conversa a marca como lida e zera o contador
    useEffect(() => {
        if (!selectedJid || !sessionId) return;
        setChats(prev => prev.map(c => (c.jid === selectedJid && c.unread ? { ...c, unread: 0 } : c)));
        markChatRead(sessionId, selectedJid).catch(() => {});
    }, [selectedJid, sessionId]);

    const fetchChats = useCallback(async (cursor?: string, append = false) => {
        if (fetchingRef.current) return;
        fetchingRef.current = true;
        try {
            if (!cursor) setLoading(true);
            const pagina = await getChatsStatus(sessionId, PAGE_SIZE, cursor || undefined, searchQuery || undefined);
            const rawChats: ChatContact[] = pagina.chats;
            cursorRef.current = pagina.proximoCursor ?? undefined;
            
            const processChats = (newChatsList: ChatContact[], existingChatsList: ChatContact[] = []) => {
                const merged = new Map(existingChatsList.map(c => [c.jid, c]));
                (newChatsList || []).forEach((c) => {
                    const existing = merged.get(c.jid);
                    if (!existing || (c.lastMessage?.timestamp && (!existing.lastMessage?.timestamp || new Date(c.lastMessage.timestamp) > new Date(existing.lastMessage.timestamp)))) {
                        merged.set(c.jid, c);
                    }
                });
                return Array.from(merged.values());
            };

            if (append) {
                setChats(prev => processChats(rawChats, prev));
            } else {
                setChats(processChats(rawChats));
            }
            setHasMore(pagina.hasMore);
        } catch (error) {
            logger.error("ChatList", "Failed to load chats", error);
        } finally {
            setLoading(false);
            fetchingRef.current = false;
        }
    }, [sessionId, searchQuery]);

    useEffect(() => { setChats([]); setHasMore(true); cursorRef.current = undefined; fetchChats(); }, [fetchChats]);

    // Recarga com atraso: várias mensagens seguidas viram uma consulta só.
    useEffect(() => {
        recarregarRef.current = () => {
            if (recarregarTimerRef.current) clearTimeout(recarregarTimerRef.current);
            recarregarTimerRef.current = setTimeout(() => { fetchingRef.current = false; fetchChats(); }, 600);
        };
        return () => { if (recarregarTimerRef.current) clearTimeout(recarregarTimerRef.current); };
    }, [fetchChats]);

    useEffect(() => {
        const socket = getSocket();
        if (!socket) return;
        const onConnect = () => joinSession(sessionId);
        if (socket.connected) joinSession(sessionId);
        socket.on("connect", onConnect);
        const handler = async (newMessages: IncomingMessage[]) => {
            const donoDe = (c: ChatContact, jid: string) => c.jid === jid || !!c.jids?.includes(jid);
            // Mensagem de uma conversa que ainda não está na lista: recarrega (fora do updater, que o React pode repetir).
            const needsReload = newMessages.some(m => !chatsRef.current.some(c => donoDe(c, m.remoteJid)));
            setChats(prev => {
                const updated = [...prev];
                newMessages.forEach(msg => {
                    const jid = msg.remoteJid;
                    const idx = updated.findIndex(c => donoDe(c, jid));
                    if (idx !== -1) {
                        const isOpen = !!selectedJidRef.current && donoDe(updated[idx], selectedJidRef.current);
                        const isIncoming = !msg.fromMe;
                        updated[idx] = {
                            ...updated[idx],
                            unread: isIncoming && !isOpen ? (updated[idx].unread || 0) + 1 : (isOpen ? 0 : updated[idx].unread),
                            lastMessage: { content: msg.content, timestamp: msg.timestamp, type: msg.type }
                        };
                        if (isIncoming && isOpen) markChatRead(sessionId, jid).catch(() => {});
                    }
                });
                updated.sort((a, b) => {
                    const tA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
                    const tB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
                    return tB - tA;
                });
                return updated;
            });
            if (needsReload) recarregarRef.current?.();
        };
        socket.on("message.update", handler);
        return () => { socket.off("connect", onConnect); socket.off("message.update", handler); };
    }, [sessionId, getSocket, joinSession, fetchChats]);

    // Fetch label assignments for all chats
    useEffect(() => {
        if (!sessionId) return;
        (async () => {
            try {
                // Batch fetch all chat-label assignments in 1 call
                const res = await fetch(`/api/labels/${sessionId}/chats`);
                if (!res.ok) return;
                const data = await res.json();
                const map = new Map<string, { colorHex: string }[]>();
                for (const cl of (data.data || [])) {
                    const jid = cl.chatJid;
                    if (!map.has(jid)) map.set(jid, []);
                    map.get(jid)!.push({ colorHex: cl.colorHex });
                }
                setChatLabelMap(map);
            } catch (e) {
                logger.error("ChatList", "Failed to load label assignments", e);
            }
        })();
    }, [sessionId]);

    const handleSearchChange = (val: string) => {
        setSearchInput(val);
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(() => {
            setSearchQuery(val);
        }, 300);
    };

    // A busca roda no banco (acha conversas antigas, fora da primeira página); a lista já vem filtrada.
    const filteredChats = chats;

    const handleEndReached = useCallback(() => {
        if (hasMore && !loading && cursorRef.current) fetchChats(cursorRef.current, true);
    }, [hasMore, loading, fetchChats]);

    const itemContent = useCallback(
        (_: number, chat: ChatContact) => <ChatRow key={chat.jid} chat={chat} isSelected={selectedJid === chat.jid} onSelect={onSelectChat} sessionId={sessionId} labelDots={chatLabelMap.get(chat.jid) || []} />,
        [selectedJid, onSelectChat, sessionId, chatLabelMap]
    );

    const handleStartNewChat = () => {
        if (!newChatNumber) return;
        onSelectChat(jidDoTelefone(newChatNumber));
        setIsNewChatOpen(false);
        setNewChatNumber("");
    };

    if (loading && chats.length === 0) {
        return (
            <div className="flex flex-col h-full overflow-hidden">
                <div className="p-3 space-y-3">
                    <Skeleton className="h-9 w-full rounded-lg" />
                    {[1, 2, 3, 4, 5].map(i => <SkeletonRow key={i} />)}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden bg-background">
            {/* Header */}
            <div className="shrink-0 px-3 pt-3 pb-2 space-y-2 border-b border-border/10">
                <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-base text-foreground">
                        
                        Conversas
                        {chats.length > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">({chats.length})</span>}
                    </h3>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg"
                        onClick={() => setIsNewChatOpen(!isNewChatOpen)}>
                        {isNewChatOpen ? <X className="h-4 w-4" /> : <MessageSquarePlus className="h-4 w-4" />}
                    </Button>
                </div>

                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="Buscar conversas..." value={searchInput}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        className="h-8 pl-8 text-sm bg-muted/50 border-0 rounded-lg focus-visible:ring-1" />
                </div>

                {isNewChatOpen && (
                    <div className="p-2.5 bg-muted/30 rounded-lg space-y-2 border border-border/40">
                        <Label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Número de telefone</Label>
                        <div className="flex gap-1.5">
                            <Input placeholder="(61) 99999-0000" value={newChatNumber}
                                onChange={(e) => setNewChatNumber(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleStartNewChat()}
                                className="h-8 text-sm" />
                            <Button size="sm" className="h-8 px-3" onClick={handleStartNewChat}>Ir</Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Chat list */}
            <div className="flex-1 min-h-0">
                {filteredChats.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                        <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                            <MessageCircle className="h-6 w-6 text-muted-foreground/50" />
                        </div>
                        <p className="text-sm text-muted-foreground">{searchQuery ? "Nenhuma conversa corresponde à busca" : "Nenhuma conversa ainda"}</p>
                    </div>
                ) : (
                    <Virtuoso style={{ height: "100%" }} data={filteredChats}
                        computeItemKey={(_: number, chat: ChatContact) => chat.jid} itemContent={itemContent}
                        endReached={handleEndReached} increaseViewportBy={200}
                        components={{ Footer: () => hasMore && !loading ? (
                            <div className="py-4 text-center">
                                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Role para ver mais</span>
                            </div>
                        ) : null }} />
                )}
            </div>
        </div>
    );
}
