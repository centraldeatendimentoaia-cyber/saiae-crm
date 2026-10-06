"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/brand-logo";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        if (!email.includes("@")) {
            setError("Digite um e-mail válido");
            return;
        }
        setLoading(true);
        try {
            const res = await fetch("/api/auth/forgot-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });
            if (!res.ok) throw new Error();
            setSent(true);
        } catch {
            setError("Não foi possível enviar agora. Tente de novo em instantes.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
            <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-500">
                <div className="mb-8 flex flex-col items-center">
                    <BrandLogo crm className="h-14 mb-6" />
                    <h1 className="text-3xl font-bold tracking-tight">Esqueceu a senha?</h1>
                    <p className="mt-2 text-center text-muted-foreground">
                        Digite o e-mail da sua conta e enviaremos um link para criar uma nova senha.
                    </p>
                </div>

                <div className="rounded-[24px] bg-card p-8">
                    {sent ? (
                        <div className="space-y-4 text-center">
                            <p className="font-semibold">Pronto! Confira o seu e-mail.</p>
                            <p className="text-sm text-muted-foreground">
                                Se <b>{email}</b> tiver uma conta, o link chega em poucos minutos e vale por 1 hora. Olhe também a caixa de spam.
                            </p>
                            <Link href="/auth/login" className="inline-block text-sm font-semibold underline underline-offset-4">
                                Voltar para o login
                            </Link>
                        </div>
                    ) : (
                        <form onSubmit={onSubmit} className="space-y-5">
                            {error && (
                                <div className="rounded-[14px] bg-err-bg p-4 text-center text-sm font-medium text-err-tx">{error}</div>
                            )}
                            <div className="space-y-2">
                                <Label htmlFor="email">E-mail</Label>
                                <Input id="email" type="email" autoComplete="email" placeholder="nome@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                            </div>
                            <Button type="submit" size="lg" className="w-full" disabled={loading}>
                                {loading ? <><Loader2 className="animate-spin" /> Enviando...</> : "Enviar link"}
                            </Button>
                        </form>
                    )}
                </div>

                {!sent && (
                    <div className="mt-8 text-center text-sm">
                        <Link href="/auth/login" className="inline-flex items-center gap-1 font-semibold underline underline-offset-4">
                            <ArrowLeft className="h-4 w-4" /> Voltar para o login
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
