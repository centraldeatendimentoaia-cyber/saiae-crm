export interface BroadcastProgress {
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

export interface BroadcastRecipient {
    id: string;
    jid: string;
    status: string;
    error: string | null;
    sentAt: string | null;
}

export interface BroadcastLog {
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

export const formatJid = (jid: string) => {
    if (!jid) return "-";
    return jid.replace("@s.whatsapp.net", "").replace("@g.us", " (Grupo)");
};

export const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
