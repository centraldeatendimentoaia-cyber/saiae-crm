"use client";

import { errorMessage } from "@/lib/errors";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/brand-logo";

function ResetForm() {
    const router = useRouter();
    const token = useSearchParams().get("token") || "";
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres");
        if (password !== confirm) return setError("As senhas não coincidem");
        setLoading(true);
        try {
            const res = await fetch("/api/auth/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, password }),
            });
            const data = await res.json();
            if (!res.ok || !data.status) throw new Error(data.message || "Falha ao alterar a senha");
            setDone(true);
            setTimeout(() => router.push("/auth/login"), 2500);
        } catch (err) {
            setError(errorMessage(err, "Falha ao alterar a senha"));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
            <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-500">
                <div className="mb-8 flex flex-col items-center">
                    <BrandLogo crm className="h-14 mb-6" />
                    <h1 className="text-3xl font-bold tracking-tight">Nova senha</h1>
                    <p className="mt-2 text-center text-muted-foreground">Escolha uma senha com pelo menos 8 caracteres.</p>
                </div>

                <div className="rounded-[24px] bg-card p-8">
                    {!token ? (
                        <div className="space-y-4 text-center">
                            <p className="font-semibold">Link inválido</p>
                            <Link href="/auth/forgot-password" className="inline-block text-sm font-semibold underline underline-offset-4">
                                Pedir um novo link
                            </Link>
                        </div>
                    ) : done ? (
                        <div className="space-y-2 text-center">
                            <p className="font-semibold">Senha alterada com sucesso!</p>
                            <p className="text-sm text-muted-foreground">Levando você para o login...</p>
                        </div>
                    ) : (
                        <form onSubmit={onSubmit} className="space-y-5">
                            {error && (
                                <div className="rounded-[14px] bg-err-bg p-4 text-center text-sm font-medium text-err-tx">
                                    {error}
                                    {error.includes("expirou") && (
                                        <>
                                            {" "}
                                            <Link href="/auth/forgot-password" className="underline underline-offset-4">Pedir novo link</Link>
                                        </>
                                    )}
                                </div>
                            )}
                            <div className="space-y-2">
                                <Label htmlFor="password">Nova senha</Label>
                                <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="confirm">Confirmar nova senha</Label>
                                <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                            </div>
                            <Button type="submit" size="lg" className="w-full" disabled={loading}>
                                {loading ? <><Loader2 className="animate-spin" /> Salvando...</> : "Salvar nova senha"}
                            </Button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
            <ResetForm />
        </Suspense>
    );
}
