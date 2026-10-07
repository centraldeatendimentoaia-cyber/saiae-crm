"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, FileUp, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type Tab = "contacts" | "labels" | "groups" | "file";

interface Item {
    id: string;
    name: string;
    sub?: string;
    color?: string;
    phones: string[];
}

const TABS: { id: Tab; label: string }[] = [
    { id: "contacts", label: "Contatos" },
    { id: "labels", label: "Etiquetas" },
    { id: "groups", label: "Grupos" },
    { id: "file", label: "Planilha" },
];

const digits = (s: string) => s.replace(/\D/g, "");

/** Junta números novos à lista (um por linha), sem repetir. */
export function mergeNumbers(current: string, add: string[]): { text: string; added: number } {
    const lines = current.split(/[\n,;]+/).map(l => l.trim()).filter(Boolean);
    const seen = new Set(lines.map(digits));
    let added = 0;
    for (const p of add) {
        const d = digits(p);
        if (d.length < 8 || seen.has(d)) continue;
        seen.add(d);
        lines.push(d);
        added++;
    }
    return { text: lines.join("\n"), added };
}

interface Props {
    sessionId: string | undefined;
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
}

/** Escolhe destinatários por contatos, etiquetas, grupos ou planilha; os números vão para a lista abaixo. */
export function RecipientPicker({ sessionId, value, onChange, disabled }: Props) {
    const [tab, setTab] = useState<Tab>("contacts");
    const [cache, setCache] = useState<Partial<Record<Tab, Item[]>>>({});
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => { setCache({}); setPicked(new Set()); }, [sessionId]);

    useEffect(() => {
        setPicked(new Set());
        setSearch("");
        if (!sessionId || tab === "file" || cache[tab]) return;
        let cancelled = false;
        setLoading(true);
        fetch(`/api/recipients/${sessionId}?type=${tab}`)
            .then(r => r.json())
            .then(j => { if (!cancelled && j.status) setCache(c => ({ ...c, [tab]: j.data })); })
            .catch(() => toast.error("Não foi possível carregar a lista."))
            .finally(() => !cancelled && setLoading(false));
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, sessionId]);

    const items = cache[tab] || [];
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return items;
        return items.filter(i => i.name.toLowerCase().includes(q) || (i.sub || "").toLowerCase().includes(q) || i.phones.some(p => p.includes(digits(q) || "§")));
    }, [items, search]);

    const toggle = (id: string) => setPicked(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const allFilteredPicked = filtered.length > 0 && filtered.every(i => picked.has(i.id));
    const toggleAll = () => setPicked(allFilteredPicked ? new Set() : new Set(filtered.map(i => i.id)));

    const addPicked = () => {
        const phones = items.filter(i => picked.has(i.id)).flatMap(i => i.phones);
        const { text, added } = mergeNumbers(value, phones);
        onChange(text);
        setPicked(new Set());
        toast.success(added ? `${added} ${added === 1 ? "número adicionado" : "números adicionados"} à lista.` : "Esses números já estavam na lista.");
    };

    const readFile = async (file: File | undefined) => {
        if (!file) return;
        try {
            const text = await file.text();
            // pega qualquer sequência que pareça telefone (com DDI/DDD, espaços, hífens, parênteses)
            const found = (text.match(/\+?\d[\d\s().-]{7,18}\d/g) || []).map(digits).map(d => (d.length === 10 || d.length === 11 ? `55${d}` : d));
            const { text: merged, added } = mergeNumbers(value, found);
            onChange(merged);
            toast.success(added ? `${added} números importados da planilha.` : "Nenhum número novo encontrado no arquivo.");
        } catch {
            toast.error("Não consegui ler o arquivo. Use CSV ou TXT.");
        } finally {
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const total = value.split(/[\n,;]+/).map(l => l.trim()).filter(Boolean).length;

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-1 rounded-lg bg-muted/50 p-1">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => setTab(t.id)}
                        className={cn(
                            "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                            tab === t.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === "file" ? (
                <div className="space-y-2 rounded-lg border border-dashed border-border p-4">
                    <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={e => readFile(e.target.files?.[0])} />
                    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => fileRef.current?.click()}>
                        <FileUp /> Escolher arquivo CSV ou TXT
                    </Button>
                    <p className="text-xs text-muted-foreground">
                        O sistema procura os telefones em qualquer coluna (ex.: salve a planilha do Excel como CSV). Números com 10 ou 11 dígitos ganham o 55 do Brasil.
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Pesquisar..." className="pl-9" disabled={disabled} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <label className="flex cursor-pointer items-center gap-2">
                            <Checkbox checked={allFilteredPicked} onCheckedChange={toggleAll} disabled={disabled || filtered.length === 0} />
                            Selecionar todos ({filtered.length})
                        </label>
                        <span>{picked.size} selecionados</span>
                    </div>
                    <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                        {loading ? (
                            <p className="p-3 text-sm text-muted-foreground">Carregando...</p>
                        ) : filtered.length === 0 ? (
                            <p className="p-3 text-sm text-muted-foreground">
                                {items.length === 0 ? "Nada por aqui ainda. Conecte o número e sincronize para ver contatos, etiquetas e grupos." : "Nenhum resultado."}
                            </p>
                        ) : (
                            filtered.slice(0, 300).map(i => (
                                <label key={i.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50">
                                    <Checkbox checked={picked.has(i.id)} onCheckedChange={() => toggle(i.id)} disabled={disabled} />
                                    {i.color && <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: i.color }} />}
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">{i.name}</span>
                                        {i.sub && <span className="block truncate text-xs text-muted-foreground">{i.sub}</span>}
                                    </span>
                                </label>
                            ))
                        )}
                        {filtered.length > 300 && (
                            <p className="p-2 text-center text-xs text-muted-foreground">Mostrando 300 de {filtered.length}. Use a pesquisa ou "Selecionar todos".</p>
                        )}
                    </div>
                    <Button type="button" size="sm" onClick={addPicked} disabled={disabled || picked.size === 0}>
                        Adicionar selecionados à lista
                    </Button>
                </div>
            )}

            <div className="flex items-center justify-between pt-1">
                <span className="text-sm font-medium">Números selecionados ({total})</span>
                {total > 0 && (
                    <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange("")}>
                        <X /> Limpar lista
                    </Button>
                )}
            </div>
        </div>
    );
}
