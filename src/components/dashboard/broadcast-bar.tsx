"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radio } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useSession } from "@/components/dashboard/session-provider";

interface Running {
    id: string;
    total: number;
    sent: number;
    failed: number;
}

/** Faixa fixa no topo de qualquer tela do painel enquanto um disparo está rodando. */
export function BroadcastBar() {
    const { sessionId } = useSession();
    const pathname = usePathname();
    const [running, setRunning] = useState<Running | null>(null);

    useEffect(() => {
        if (!sessionId) return;
        let stop = false;
        let timer: ReturnType<typeof setTimeout>;

        const tick = async () => {
            let next = 8000;
            try {
                const res = await fetch(`/api/messages/${sessionId}/broadcast/history?limit=1`);
                const j = await res.json();
                const l = j?.data?.[0];
                if (!stop) {
                    if (l?.status === "running") {
                        setRunning({ id: l.id, total: l.total, sent: l.sent, failed: l.failed });
                        next = 3000;
                    } else {
                        setRunning(null);
                    }
                }
            } catch { /* tenta de novo */ }
            if (!stop) timer = setTimeout(tick, next);
        };
        tick();
        return () => { stop = true; clearTimeout(timer); };
    }, [sessionId]);

    if (!running) return null;

    const done = running.sent + running.failed;
    const pct = running.total ? Math.round((done / running.total) * 100) : 0;
    const onBroadcastPage = pathname?.startsWith("/dashboard/broadcast");

    const cancel = async () => {
        if (!window.confirm("Cancelar o disparo? As mensagens que faltam não serão enviadas.")) return;
        const res = await fetch(`/api/messages/${sessionId}/broadcast/cancel`, { method: "POST" });
        if (res.ok) { toast.info("Disparo cancelado."); setRunning(null); }
        else toast.error("Não foi possível cancelar.");
    };

    return (
        <div className="sticky top-0 z-30 mb-4 rounded-lg border border-border bg-background/95 p-3 shadow-sm backdrop-blur">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="flex items-center gap-2 text-sm font-semibold">
                    <Radio className="h-4 w-4 animate-pulse" /> Disparo em andamento
                </span>
                <span className="font-mono text-sm tabular-nums">
                    {done} / {running.total} ({pct}%)
                </span>
                <span className="text-xs text-muted-foreground">{running.sent} enviadas · {running.failed} falhas</span>
                <div className="ml-auto flex gap-2">
                    {!onBroadcastPage && (
                        <Button asChild size="sm" variant="outline"><Link href="/dashboard/broadcast">Ver disparo</Link></Button>
                    )}
                    <Button size="sm" variant="outline" onClick={cancel}>Cancelar</Button>
                </div>
            </div>
            <Progress value={pct} className="mt-2 h-2" />
        </div>
    );
}
