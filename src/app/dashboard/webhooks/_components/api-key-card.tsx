"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Key, Copy, RefreshCw, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function ApiKeyCard() {
    const [apiKey, setApiKey] = useState<string | null>(null);
    // Chave completa: o servidor só a devolve na criação; depois disso só existe a máscara.
    const [novaChave, setNovaChave] = useState<string | null>(null);
    const [showApiKey, setShowApiKey] = useState(false);
    const [showRegenConfirm, setShowRegenConfirm] = useState(false);

    const fetchApiKey = async () => {
        try {
            const res = await fetch("/api/user/api-key");
            if (res.ok) {
                const data = await res.json();
                setApiKey(data?.data?.apiKey);
            }
        } catch (error) {
            logger.error("Webhooks", "Falha ao carregar a chave de API", error);
        }
    };

    useEffect(() => { fetchApiKey(); }, []);

    const generateNewApiKey = async () => {
        try {
            const res = await fetch("/api/user/api-key", { method: "POST" });
            if (res.ok) {
                const data = await res.json();
                setApiKey(data?.data?.apiKey);
                setNovaChave(data?.data?.apiKey ?? null);
                setShowApiKey(true);
                toast.success("Nova chave de API gerada! Copie agora: ela não será mostrada de novo.");
            }
        } catch {
            toast.error("Falha ao gerar a chave de API");
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success("Copiado para a área de transferência!");
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5" />  Chave de API
                </CardTitle>
                <CardDescription>
                    Use esta chave para autenticar as requisições da API. Envie-a no cabeçalho X-API-Key.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                    <div className="flex-1 bg-zinc-100 rounded-md p-2 sm:p-3 font-mono text-xs sm:text-sm overflow-x-auto">
                        {apiKey ? (
                            novaChave && !showApiKey ? "••••••••••••••••••••••••••••••••" : apiKey
                        ) : (
                            <span className="text-muted-foreground">Nenhuma chave de API gerada</span>
                        )}
                    </div>
                    {novaChave && (
                        <>
                            <Button variant="ghost" size="icon" onClick={() => setShowApiKey(!showApiKey)} aria-label={showApiKey ? "Ocultar a chave de API" : "Mostrar a chave de API"} title={showApiKey ? "Ocultar a chave" : "Mostrar a chave"}>
                                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => copyToClipboard(novaChave)} aria-label="Copiar a chave de API" title="Copiar a chave">
                                <Copy className="h-4 w-4" />
                            </Button>
                        </>
                    )}
                    <Button onClick={() => {
                        if (apiKey) setShowRegenConfirm(true);
                        else generateNewApiKey();
                    }}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        {apiKey ? "Gerar nova" : "Gerar"}
                    </Button>
                </div>
                {apiKey && !novaChave && (
                    <p className="text-xs text-muted-foreground mt-2">
                        Por segurança a chave completa só aparece ao ser gerada. Se a perdeu, use "Gerar nova".
                    </p>
                )}
                {apiKey && (
                    <p className="text-xs text-muted-foreground mt-2">
                        Exemplo: <code className="bg-zinc-100 px-1 py-0.5 rounded">curl -H "X-API-Key: {novaChave ? novaChave.slice(0, 10) : "SUA_CHAVE"}..." http://seu-servidor/api/sessions</code>
                    </p>
                )}
            </CardContent>

            <AlertDialog open={showRegenConfirm} onOpenChange={setShowRegenConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Gerar nova chave de API?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Isso invalidará sua chave de API atual. Todas as integrações que usam a chave antiga deixarão de funcionar imediatamente. Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { setShowRegenConfirm(false); generateNewApiKey(); }} className="bg-red-600 hover:bg-red-700">Gerar nova</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
