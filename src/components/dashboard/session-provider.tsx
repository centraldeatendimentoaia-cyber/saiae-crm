"use client";

import { logger } from "@/lib/logger";
import { createContext, useContext, useEffect, useRef, useState, useTransition, ReactNode } from "react";
import { getCookie, setCookie } from "@/lib/client-cookie";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface Session {
    id: string;
    sessionId: string;
    name: string;
    status: string;
}

interface SessionContextType {
    sessions: Session[];
    sessionId: string;
    setSessionId: (id: string) => void;
    refreshSessions: () => Promise<void>;
    loading: boolean;
    switchingTo: string | null;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [sessionId, setSessionIdState] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [switchingTo, setSwitchingTo] = useState<string | null>(null);
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const switchStartedAt = useRef(0);

    const fetchSessions = async () => {
        try {
            const res = await fetch('/api/sessions');
            if (res.ok) {
                const responseData = await res.json();
                const data = responseData?.data || [];
                // Filter connected only? Or showing all but disabled?
                // Logic: Only show CONNECTED in selector for "Active" operations.
                // Show all sessions so users can manage disconnected ones (e.g. webhooks, settings)
                setSessions(data);

                // Sync with cookie
                const cookieId = getCookie("sessionId");
                if (cookieId && data.find((s: Session) => s.sessionId === cookieId)) {
                    setSessionIdState(cookieId);
                } else if (data.length > 0) {
                    // Default to first
                    const first = data[0].sessionId;
                    setSessionIdState(first);
                    setCookie("sessionId", first);
                } else {
                    setSessionIdState("");
                }
            }
        } catch (error) {
            logger.error("SessionProvider", "Erro", error);
            toast.error("Falha ao carregar as sessões");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSessions();
    }, []);

    // O overlay fica até o router.refresh() terminar (senão sobra página de servidor da sessão anterior), por pelo menos 600 ms para não piscar.
    useEffect(() => {
        if (!switchingTo || pending) return;
        const t = setTimeout(() => setSwitchingTo(null), Math.max(0, 600 - (Date.now() - switchStartedAt.current)));
        return () => clearTimeout(t);
    }, [switchingTo, pending]);

    const setSessionId = (id: string) => {
        if (id === sessionId) return;
        switchStartedAt.current = Date.now();
        setSwitchingTo(sessions.find((s) => s.sessionId === id)?.name || id);
        setSessionIdState(id);
        setCookie("sessionId", id); // Sync Cookie
        startTransition(() => router.refresh()); // Sync Server Components
    };

    return (
        <SessionContext.Provider value={{ sessions, sessionId, setSessionId, refreshSessions: fetchSessions, loading, switchingTo }}>
            {children}
        </SessionContext.Provider>
    );
}

export function useSession() {
    const context = useContext(SessionContext);
    if (!context) {
        throw new Error("useSession must be used within a SessionProvider");
    }
    return context;
}
