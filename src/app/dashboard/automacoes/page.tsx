"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, RefreshCw, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/components/dashboard/session-provider";

interface Fluxo { id: string; name: string; sessionId: string; status: string; publishedVersionId: string | null; updatedAt: string }

export default function AutomacoesPage() {
    const router = useRouter();
    const { sessions, sessionId } = useSession();
    const [fluxos, setFluxos] = useState<Fluxo[] | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [nome, setNome] = useState("");
    const [sessao, setSessao] = useState("");
    const [criando, setCriando] = useState(false);

    const carregar = useCallback(async () => {
        setErro(null);
        try {
            const res = await fetch("/api/automacoes");
            const j = await res.json().catch(() => ({}));
            if (!res.ok || j.status === false) throw new Error(j.message || "Falha ao carregar os fluxos");
            setFluxos(j.data.flows);
        } catch (e) {
            setErro(e instanceof Error ? e.message : "Falha ao carregar os fluxos");
        }
    }, []);
    useEffect(() => { carregar(); }, [carregar]);
    useEffect(() => { if (!sessao && sessionId) setSessao(sessionId); }, [sessionId, sessao]);

    const criar = async (e: React.FormEvent) => {
        e.preventDefault();
        setCriando(true);
        try {
            const res = await fetch("/api/automacoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sessao, name: nome.trim() }) });
            const j = await res.json().catch(() => ({}));
            if (!res.ok || j.status === false) throw new Error(j.message === "sessao_invalida" ? "Sessão inválida" : j.message || "Falha ao criar o fluxo");
            router.push(`/dashboard/automacoes/${j.data.id}`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Falha ao criar o fluxo");
            setCriando(false);
        }
    };

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold">Fluxos de automação</h1>
                    <p className="text-sm text-muted-foreground">Monte o fluxo, simule sem enviar nada e publique uma versão.</p>
                </div>
                <Button variant="outline" size="sm" onClick={carregar}><RefreshCw aria-hidden /> Atualizar</Button>
            </header>

            <Card>
                <CardContent className="pt-6">
                    <form onSubmit={criar} className="flex flex-wrap items-end gap-3" aria-label="Criar fluxo">
                        <div className="min-w-48 flex-1 space-y-1.5">
                            <Label htmlFor="nome-fluxo">Nome do fluxo</Label>
                            <Input id="nome-fluxo" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} required placeholder="Ex.: Boas-vindas" />
                        </div>
                        <div className="min-w-48 space-y-1.5">
                            <Label htmlFor="sessao-fluxo">Sessão do WhatsApp</Label>
                            <select id="sessao-fluxo" value={sessao} onChange={(e) => setSessao(e.target.value)} required className="h-12 w-full rounded-[10px] border border-input bg-card px-3 text-base focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-mustard-300">
                                <option value="" disabled>Escolha a sessão</option>
                                {sessions.map((s) => <option key={s.id} value={s.sessionId}>{s.name || s.sessionId}</option>)}
                            </select>
                        </div>
                        <Button type="submit" disabled={criando || !nome.trim() || !sessao}>{criando ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />} Criar fluxo</Button>
                    </form>
                </CardContent>
            </Card>

            <section aria-live="polite" aria-busy={fluxos === null && !erro}>
                {erro ? (
                    <Card><CardContent className="flex items-center justify-between gap-3 pt-6" role="alert"><span>{erro}</span><Button size="sm" onClick={carregar}>Tentar de novo</Button></CardContent></Card>
                ) : fluxos === null ? (
                    <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Carregando fluxos...</p>
                ) : fluxos.length === 0 ? (
                    <Card><CardContent className="flex flex-col items-center gap-2 py-10 text-center"><Workflow className="size-8 text-muted-foreground" aria-hidden /><p className="font-semibold">Nenhum fluxo ainda</p><p className="text-sm text-muted-foreground">Crie o primeiro acima para abrir o editor.</p></CardContent></Card>
                ) : (
                    <ul className="grid gap-3 sm:grid-cols-2">
                        {fluxos.map((f) => (
                            <li key={f.id}>
                                <Link href={`/dashboard/automacoes/${f.id}`} className="block rounded-[14px] outline-none focus-visible:ring-[3px] focus-visible:ring-mustard-300">
                                    <Card className="transition-shadow hover:shadow-md"><CardContent className="space-y-1 pt-6">
                                        <p className="font-semibold">{f.name}</p>
                                        <p className="text-sm text-muted-foreground">Sessão {f.sessionId} · {f.status === "archived" ? "Arquivado" : f.publishedVersionId ? "Publicado" : "Só rascunho"}</p>
                                        <p className="text-xs text-muted-foreground">Atualizado em {new Date(f.updatedAt).toLocaleString("pt-BR")}</p>
                                    </CardContent></Card>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
