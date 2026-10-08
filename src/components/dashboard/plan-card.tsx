"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";

interface PlanData {
    plan: { key: string; name: string };
    status: "ACTIVE" | "SUSPENDED";
    blockedReason: string | null;
    trialEndsAt: string | null;
    limits: { sessions: number | null; messages: number | null; ai: number | null };
    usage: { sessions: number; messages: number; ai: number };
    billingEnforced?: boolean;
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
    const [justPaid, setJustPaid] = useState(false);

    useEffect(() => {
        const load = () =>
            fetch("/api/me/plan")
                .then((r) => r.json())
                .then((j) => j.status && setData(j.data))
                .catch(() => {});
        load();
        // voltando do pagamento: o plano é liberado pelo webhook em poucos segundos
        if (new URLSearchParams(window.location.search).get("assinatura") === "ok") {
            setJustPaid(true);
            const timers = [3000, 7000, 15000].map((ms) => setTimeout(load, ms));
            return () => timers.forEach(clearTimeout);
        }
    }, []);

    if (!data) return null;

    // Cobrança desligada (BILLING_ENFORCEMENT): sem aviso de trial, de bloqueio nem convite para assinar.
    const billing = data.billingEnforced !== false;

    const daysLeft = billing && data.trialEndsAt
        ? Math.max(0, Math.ceil((new Date(data.trialEndsAt).getTime() - Date.now()) / 86400000))
        : null;

    return (
        <div>
            <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">Meu plano</h3>
            <Card>
                <CardContent className="space-y-5">
                    {justPaid && (
                        <div className="flex items-start gap-2 rounded-[14px] bg-ok-bg text-ok-tx px-4 py-3 text-sm font-medium">
                            <CheckCircle2 className="h-5 w-5 shrink-0" />
                            Pagamento recebido! Seu plano é atualizado em instantes.
                        </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="font-display text-2xl font-bold">{data.plan.name}</span>
                        {billing && data.status === "SUSPENDED" ? (
                            <Badge variant="destructive">Suspenso</Badge>
                        ) : data.plan.key === "TRIAL" && daysLeft !== null ? (
                            <Badge variant="warning">{daysLeft === 0 ? "Termina hoje" : `${daysLeft} dia(s) restantes`}</Badge>
                        ) : (
                            <Badge variant="success">Ativo</Badge>
                        )}
                    </div>

                    {billing && data.blockedReason && (
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
                    {billing && data.plan.key !== "ILIMITADO" && (
                        <Link href="/dashboard/assinatura" className="inline-block text-sm font-semibold underline underline-offset-4">
                            Ver planos e assinar
                        </Link>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
