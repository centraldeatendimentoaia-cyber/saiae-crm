"use client";

import { useRef, useState } from "react";
import { Send, UserRound } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Msg { papel: "cliente" | "atendente"; texto: string }

/** Chat de teste: conversa com o RASCUNHO salvo. Não envia nada pelo WhatsApp. A página usa key={sessionId}, então remonta ao trocar de sessão. */
export function ChatTeste({ sessionId, podeTestar }: { sessionId: string; podeTestar: boolean }) {
    const [msgs, setMsgs] = useState<Msg[]>([]);
    const [texto, setTexto] = useState("");
    const [enviando, setEnviando] = useState(false);
    const [aviso, setAviso] = useState<string | null>(null);
    const requisicao = useRef(0);

    const enviar = async () => {
        const t = texto.trim();
        if (!t || enviando || !podeTestar) return;
        const novas: Msg[] = [...msgs, { papel: "cliente" as const, texto: t }].slice(-30);
        const minha = ++requisicao.current;
        setMsgs(novas);
        setTexto("");
        setEnviando(true);
        setAviso(null);
        try {
            const res = await fetch(`/api/atendente/${sessionId}/teste`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mensagens: novas }) });
            const j = await res.json();
            if (minha !== requisicao.current) return;
            if (!res.ok || !j.status) throw new Error(j.message || "Falha no teste");
            const d = j.data as { resposta: string[]; passouParaPessoa: boolean; vendaRegistrada: boolean };
            setMsgs([...novas, ...d.resposta.map((x) => ({ papel: "atendente" as const, texto: x }))].slice(-30));
            const notas = [d.passouParaPessoa && "passaria a conversa para uma pessoa", d.vendaRegistrada && "registraria uma venda"].filter(Boolean);
            if (notas.length) setAviso(`Neste teste a atendente ${notas.join(" e ")} (nada foi feito de verdade).`);
        } catch (e) {
            if (minha !== requisicao.current) return;
            toast.error(errorMessage(e, "Falha no teste"));
        } finally {
            if (minha === requisicao.current) setEnviando(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Testar o rascunho</CardTitle>
                <CardDescription>Converse como se fosse o cliente. Usa o último rascunho salvo e não envia nada pelo WhatsApp.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="h-72 space-y-2 overflow-y-auto rounded-lg border p-3" aria-live="polite">
                    {msgs.length === 0 && <p className="text-sm text-muted-foreground">Escreva uma mensagem para começar.</p>}
                    {msgs.map((m, i) => (
                        <div key={i} className={`flex ${m.papel === "cliente" ? "justify-end" : "justify-start"}`}>
                            <p className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.papel === "cliente" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{m.texto}</p>
                        </div>
                    ))}
                    {enviando && <p className="text-sm text-muted-foreground">Digitando...</p>}
                </div>
                {aviso && <p className="flex items-center gap-1 text-xs text-amber-600"><UserRound className="h-3 w-3" />{aviso}</p>}
                {!podeTestar && <p className="text-xs text-muted-foreground">Salve o rascunho para poder testar.</p>}
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
                    <Input value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={2000} placeholder="Mensagem do cliente" aria-label="Mensagem do cliente" disabled={enviando || !podeTestar} />
                    <Button type="submit" disabled={enviando || !texto.trim() || !podeTestar} aria-label="Enviar mensagem de teste"><Send className="h-4 w-4" /></Button>
                </form>
                {msgs.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => { requisicao.current++; setMsgs([]); setAviso(null); setEnviando(false); }}>Limpar conversa</Button>}
            </CardContent>
        </Card>
    );
}
