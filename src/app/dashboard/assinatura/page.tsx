"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, ExternalLink } from "lucide-react";
import { PlanCard } from "@/components/dashboard/plan-card";

interface Billing {
    links: { ESSENCIAL: string | null; PRO: string | null; ESCALA: string | null; EXTRA: string | null };
    portalUrl: string | null;
}

const OFFERS = [
    {
        key: "ESSENCIAL" as const,
        name: "Essencial",
        price: 49,
        desc: "Pra começar a falar com seus clientes.",
        items: ["1 número de WhatsApp", "1.000 disparos por mês", "50 textos com IA por mês", "Agendador, respostas automáticas e etiquetas"],
    },
    {
        key: "PRO" as const,
        name: "Pro",
        price: 99,
        highlight: true,
        desc: "Pra quem tem equipe e quer acompanhar resultado.",
        items: ["2 números de WhatsApp", "5.000 disparos por mês", "300 textos com IA por mês", "Nome do cliente na mensagem"],
    },
    {
        key: "ESCALA" as const,
        name: "Escala",
        price: 199,
        desc: "Pra rede, várias unidades ou muito volume.",
        items: ["5 números de WhatsApp", "20.000 disparos por mês", "1.000 textos com IA por mês", "Suporte prioritário"],
    },
];

export default function AssinaturaPage() {
    const [billing, setBilling] = useState<Billing | null>(null);

    useEffect(() => {
        fetch("/api/me/billing")
            .then((r) => r.json())
            .then((j) => j.status && setBilling(j.data))
            .catch(() => {});
    }, []);

    return (
        <div className="max-w-5xl space-y-10 pb-16">
            <header className="space-y-3">
                <p className="kicker">Conta</p>
                <h1 className="text-4xl font-bold">Plano e assinatura</h1>
                <span className="gold-bar" />
                <p className="text-muted-foreground max-w-2xl">
                    Veja o que está incluído no seu plano e faça upgrade quando precisar. O pagamento é feito em ambiente seguro da Stripe e o plano é liberado em instantes.
                </p>
            </header>

            <PlanCard />

            {billing?.portalUrl && (
                <div className="flex flex-wrap items-center gap-3">
                    <Button asChild variant="outline">
                        <a href={billing.portalUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink /> Gerenciar assinatura
                        </a>
                    </Button>
                    <span className="text-sm text-muted-foreground">Trocar cartão, ver faturas, mudar de plano ou cancelar.</span>
                </div>
            )}

            <div className="grid gap-5 md:grid-cols-3">
                {OFFERS.map((o) => {
                    const link = billing?.links[o.key];
                    return (
                        <Card key={o.key} className={o.highlight ? "ring-2 ring-foreground" : ""}>
                            <CardContent className="space-y-5">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-2xl font-extrabold">{o.name}</h2>
                                    {o.highlight && <Badge>Recomendado</Badge>}
                                </div>
                                <p className="text-sm text-muted-foreground">{o.desc}</p>
                                <p className="font-display">
                                    <span className="text-lg font-bold">R$ </span>
                                    <span className="text-5xl font-extrabold tracking-tight">{o.price}</span>
                                    <span className="text-sm text-muted-foreground font-sans"> /mês</span>
                                </p>
                                <ul className="space-y-2 text-sm">
                                    {o.items.map((i) => (
                                        <li key={i} className="flex items-start gap-2">
                                            <Check className="h-5 w-5 shrink-0 text-ok" /> {i}
                                        </li>
                                    ))}
                                </ul>
                                {link ? (
                                    <Button asChild size="lg" variant={o.highlight ? "default" : "outline"} className="w-full">
                                        <a href={link}>Assinar {o.name}</a>
                                    </Button>
                                ) : (
                                    <Button size="lg" variant="outline" className="w-full" disabled>
                                        Em breve
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {billing?.links.EXTRA && (
                <Card>
                    <CardContent className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-bold">Número de WhatsApp extra</h3>
                            <p className="text-sm text-muted-foreground">Conecte mais um número à sua conta por R$ 29/mês cada.</p>
                        </div>
                        <Button asChild variant="secondary">
                            <a href={billing.links.EXTRA}>Adicionar número</a>
                        </Button>
                    </CardContent>
                </Card>
            )}

            <p className="text-xs text-muted-foreground">
                Use o mesmo e-mail da sua conta no pagamento. Dúvidas? Fale com a gente pelo WhatsApp.
            </p>
        </div>
    );
}
