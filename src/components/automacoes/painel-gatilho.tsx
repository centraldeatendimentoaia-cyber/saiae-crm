"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DiagnosticoGatilho } from "@/modules/automacoes/gatilhos/catalogo";

interface Conta { id: string; provider: string; name: string; username?: string | null }
interface Gatilho { id?: string; tipo?: string; canal?: string; accountId?: string; palavras?: string[]; postId?: string }

const campo = "w-full rounded-[10px] border border-input bg-card px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-mustard-300";

/** Gatilho do fluxo (Instagram/Messenger). Opções sem permissão ou sem flag aparecem desabilitadas com o motivo. */
export function PainelGatilho({ valor, onMudar }: { valor: unknown; onMudar: (v: unknown) => void }) {
    const g = (valor ?? {}) as Gatilho;
    const [diag, setDiag] = useState<DiagnosticoGatilho[] | null>(null);
    const [contas, setContas] = useState<Conta[]>([]);
    const [erro, setErro] = useState(false);

    useEffect(() => {
        let vivo = true;
        Promise.all([fetch("/api/automacoes/gatilhos/diagnostico").then((r) => r.json()), fetch("/api/social/accounts").then((r) => r.json())])
            .then(([d, c]) => { if (!vivo) return; setDiag(d?.data?.gatilhos ?? []); setContas(c?.data ?? []); })
            .catch(() => vivo && setErro(true));
        return () => { vivo = false; };
    }, []);

    const atual = diag?.find((d) => d.id === g.id);
    const set = (patch: Partial<Gatilho>) => onMudar({ ...g, ...patch });
    const escolher = (id: string) => {
        if (!id) return onMudar(undefined);
        const d = diag?.find((x) => x.id === id);
        if (d) onMudar({ ...g, id, tipo: id.replace(/^(instagram|messenger)_/, ""), canal: d.canal });
    };

    return (
        <section aria-label="Gatilho" className="space-y-2">
            <h2 className="text-sm font-bold">Gatilho (Instagram e Messenger)</h2>
            <p className="text-xs text-muted-foreground">Sem gatilho, o fluxo só inicia manualmente. Os gatilhos da Meta dependem de permissões que o app ainda não tem.</p>
            {erro && <p role="alert" className="text-sm text-destructive">Não foi possível carregar o diagnóstico dos gatilhos.</p>}
            <div className="space-y-1.5">
                <Label htmlFor="g-tipo">Quando iniciar</Label>
                <select id="g-tipo" className={campo} value={g.id ?? ""} onChange={(e) => escolher(e.target.value)} disabled={!diag}>
                    <option value="">Somente manual</option>
                    {diag?.map((d) => <option key={d.id} value={d.id} disabled={d.estado !== "habilitado" && d.id !== g.id}>{d.titulo}{d.estado !== "habilitado" ? " (indisponível)" : ""}</option>)}
                </select>
            </div>
            {atual && atual.estado !== "habilitado" && <p role="status" className="rounded-lg border border-destructive p-2 text-sm text-destructive">Este gatilho não vai disparar: {atual.motivo}.</p>}
            {g.id && (
                <>
                    <div className="space-y-1.5">
                        <Label htmlFor="g-conta">Conta</Label>
                        <select id="g-conta" className={campo} value={g.accountId ?? ""} onChange={(e) => set({ accountId: e.target.value })}>
                            <option value="">(escolha a conta)</option>
                            {contas.filter((c) => (g.canal === "instagram" ? c.provider === "instagram" : c.provider === "facebook")).map((c) => <option key={c.id} value={c.id}>{c.username ? `@${c.username}` : c.name}</option>)}
                        </select>
                    </div>
                    {g.tipo !== "dm_qualquer" && <div className="space-y-1.5"><Label htmlFor="g-pal">Palavras-chave (separadas por vírgula)</Label><Input id="g-pal" value={(g.palavras ?? []).join(", ")} onChange={(e) => set({ palavras: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></div>}
                    {g.tipo === "comentario_post" && <div className="space-y-1.5"><Label htmlFor="g-post">Id do post (vazio = qualquer post)</Label><Input id="g-post" value={g.postId ?? ""} onChange={(e) => set({ postId: e.target.value.trim() || undefined })} /></div>}
                </>
            )}
        </section>
    );
}
