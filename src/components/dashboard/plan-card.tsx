"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

interface PlanData {
    plan: { key: string; name: string };
    status: "ACTIVE" | "SUSPENDED";
    blockedReason: string | null;
    trialEndsAt: string | null;
    limits: { sessions: number | null; messages: number | null; ai: number | null };
    usage: { sessions: number; messages: number; ai: number };
}

function Meter({ label, used, max }: { label: string; used: number; max: number | null }) {
    const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
    const near = max !== null && pct >= 80;
    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
                <span className="kicker">{label}</span>
                <span className="text-sm font-semibold tabular-nums">
                    {used.toLocaleString("pt-BR")}
                    <span className="text-muted-foreground font-medium"> / {max === null ? "ilimitado" : max.toLocaleString("pt-BR")}</span>
                </span>
            </div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                    className={`h-full rounded-full ${near ? "bg-warn" : "bg-brand"}`}
                    style={{ width: max === null ? "0%" : `${pct}%` }}
                />
            </div>
        </div>
    );
}

export function PlanCard() {
    const [data, setData] = useState<PlanData | null>(null);

    useEffect(() => {
        fetch("/api/me/plan")
            .then((r) => r.json())
            .then((j) => j.status && setData(j.data))
            .catch(() => {});
    }, []);

    if (!data) return null;

    const daysLeft = data.trialEndsAt
        ? Math.max(0, Math.ceil((new Date(data.trialEndsAt).getTime() - Date.now()) / 86400000))
        : null;

    return (
        <div>
            <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">Meu plano</h3>
            <Card>
                <CardContent className="space-y-5">
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="font-display text-2xl font-bold">{data.plan.name}</span>
                        {data.status === "SUSPENDED" ? (
                            <Badge variant="destructive">Suspenso</Badge>
                        ) : data.plan.key === "TRIAL" && daysLeft !== null ? (
                            <Badge variant="warning">{daysLeft === 0 ? "Termina hoje" : `${daysLeft} dia(s) restantes`}</Badge>
                        ) : (
                            <Badge variant="success">Ativo</Badge>
                        )}
                    </div>

                    {data.blockedReason && (
                        <div className="flex items-start gap-2 rounded-[14px] bg-err-bg text-err-tx px-4 py-3 text-sm font-medium">
                            <AlertTriangle className="h-5 w-5 shrink-0" />
                            {data.blockedReason}
                        </div>
                    )}

                    <div className="grid gap-5 sm:grid-cols-3">
                        <Meter label="Números de WhatsApp" used={data.usage.sessions} max={data.limits.sessions} />
                        <Meter label="Disparos no mês" used={data.usage.messages} max={data.limits.messages} />
                        <Meter label="Textos com IA no mês" used={data.usage.ai} max={data.limits.ai} />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
