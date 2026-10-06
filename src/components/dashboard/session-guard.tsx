"use client";

import { useSession } from "./session-provider";
import { Bot, QrCode } from "lucide-react";
import { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function SessionGuard({ children }: { children: ReactNode }) {
    const { sessionId, loading, sessions } = useSession();

    if (loading) {
        return <div className="flex h-full items-center justify-center p-8">Carregando sessão...</div>;
    }

    if (!sessionId) {
        return (
            <div className="flex h-full flex-col items-center justify-center space-y-6 text-center p-8">
                <div className="rounded-full bg-green-100 p-6">
                    <QrCode className="h-12 w-12 text-green-600" />
                </div>
                <div className="space-y-2 max-w-md">
                    <h2 className="text-2xl font-bold tracking-tight">Nenhuma sessão ativa</h2>
                    <p className="text-zinc-500">
                        
                        Selecione uma sessão de WhatsApp na barra de navegação superior para acessar este recurso.
                    </p>
                </div>

                {sessions.length === 0 && (
                    <div className="flex flex-col gap-2">
                        <p className="text-sm text-zinc-500">Você ainda não tem nenhuma sessão.</p>
                        <Link href="/dashboard/sessions">
                            <Button variant="outline">Criar uma sessão</Button>
                        </Link>
                    </div>
                )}
            </div>
        );
    }

    return <>{children}</>;
}
