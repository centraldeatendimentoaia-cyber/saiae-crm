"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Bot, PauseCircle, PlayCircle, RefreshCw, Search, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Lead { nome: string | null; negocio: string | null; cidade: string | null; origem: string }
interface ItemLista {
    id: string;
    lojaCodigo: string;
    telefone: string;
    estado: "ia" | "humano";
    pausadaAte: string | null;
    ultimaMensagemEm: string;
    ultima: { direcao: "in" | "out"; texto: string } | null;
    lead: Lead | null;
}
interface Detalhe {
    id: string;
    lojaCodigo: string;
    telefone: string;
    estado: "ia" | "humano";
    pausadaAte: string | null;
    mensagens: { direcao: "in" | "out"; texto: string; criadoEm: string; autor?: string }[];
    lead: Lead | null;
    /** Conversa do agente de um negócio: não pode ser apagada por esta tela. */
    somenteLeitura?: boolean;
}
interface Negocio { codigo: string; nome: string; total: number }

const quando = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const iniciais = (nome: string | null | undefined, telefone: string) => {
    const base = (nome ?? "").trim();
    return base ? base.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase() : telefone.replace(/\D/g, "").slice(-2) || "?";
};

export default function AtendenteIaPage() {
    const [loja, setLoja] = useState("VENDAS");
    const [lojas, setLojas] = useState<{ codigo: string; total: number }[]>([]);
    const [negocios, setNegocios] = useState<Negocio[]>([]);
    const [erroLista, setErroLista] = useState(false);
    const [busca, setBusca] = useState("");
    const [filtro, setFiltro] = useState<"" | "ia" | "humano">("");
    const [lista, setLista] = useState<ItemLista[]>([]);
    const [carregando, setCarregando] = useState(false);
    const [selecionada, setSelecionada] = useState<string | null>(null);
    const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
    const fim = useRef<HTMLDivElement>(null);

    const carregarLista = useCallback(async () => {
        setCarregando(true);
        try {
            const p = new URLSearchParams({ loja, limite: "100" });
            if (busca.trim()) p.set("q", busca.trim());
            if (filtro) p.set("estado", filtro);
            const res = await fetch(`/api/admin/ia/conversas?${p}`);
            const j = await res.json();
            if (res.ok && j.status) {
                setLista(j.data.conversas);
                // a lista de lojas só vem na consulta das conversas da API oficial; ao olhar um negócio, mantém a anterior
                if (!loja.startsWith("WA:")) setLojas(j.data.lojas);
                setNegocios(j.data.negocios ?? []);
                setErroLista(false);
            } else {
                setErroLista(true);
                if (res.status === 403) toast.error("Só o administrador vê esta tela.");
            }
        } catch {
            setErroLista(true);
        } finally {
            setCarregando(false);
        }
    }, [loja, busca, filtro]);

    const carregarDetalhe = useCallback(async (id: string) => {
        const res = await fetch(`/api/admin/ia/conversas/${id}`);
        const j = await res.json();
        if (res.ok && j.status) setDetalhe(j.data);
    }, []);

    useEffect(() => { carregarLista(); }, [carregarLista]);
    useEffect(() => {
        const t = setInterval(carregarLista, 20000);
        return () => clearInterval(t);
    }, [carregarLista]);
    useEffect(() => {
        if (!selecionada) { setDetalhe(null); return; }
        carregarDetalhe(selecionada);
        const t = setInterval(() => carregarDetalhe(selecionada), 15000);
        return () => clearInterval(t);
    }, [selecionada, carregarDetalhe]);
    useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [detalhe?.mensagens.length, selecionada]);

    const mudarEstado = async (acao: "pausar" | "liberar") => {
        if (!detalhe) return;
        const res = await fetch(`/api/admin/ia/conversas/${detalhe.id}/estado`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ acao }),
        });
        if (res.ok) {
            toast.success(acao === "pausar" ? "IA pausada nesta conversa por 12 h." : "A IA voltou a atender esta conversa.");
            carregarDetalhe(detalhe.id);
            carregarLista();
        } else toast.error("Não foi possível mudar o estado.");
    };

    const apagar = async () => {
        if (!detalhe) return;
        if (!window.confirm("Apagar esta conversa e o lead desse telefone? Não dá para desfazer.")) return;
        const res = await fetch(`/api/admin/ia/conversas/${detalhe.id}`, { method: "DELETE" });
        if (res.ok) {
            toast.success("Conversa apagada.");
            setSelecionada(null);
            carregarLista();
        } else toast.error("Não foi possível apagar.");
    };

    const etiquetaEstado = (e: "ia" | "humano") =>
        e === "humano" ? <Badge variant="outline" className="border-yellow-500/50 text-yellow-700">Com a equipe</Badge> : <Badge variant="outline" className="border-emerald-500/50 text-emerald-700">IA atendendo</Badge>;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-3xl"><Bot className="h-7 w-7" />Atendente IA</h2>
                    <p className="text-sm text-muted-foreground">Acompanhe o que a IA conversa em cada negócio e no WhatsApp oficial do Saiaê. Escolha o negócio na lista abaixo.</p>
                </div>
                <Button variant="outline" size="sm" onClick={carregarLista} disabled={carregando} aria-label="Atualizar a lista de conversas">
                    <RefreshCw className={cn("h-4 w-4", carregando && "animate-spin")} /> Atualizar
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,22rem)_1fr]">
                {/* lista */}
                <div className={cn("space-y-2 rounded-lg border border-border p-3", selecionada && "hidden md:block")}>
                    <div className="flex gap-2">
                        <select aria-label="Negócio" value={loja} onChange={(e) => { setLoja(e.target.value); setSelecionada(null); }} className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm">
                            {negocios.length > 0 && (
                                <optgroup label="Negócios (WhatsApp conectado)">
                                    {negocios.map((n) => <option key={n.codigo} value={n.codigo}>{n.nome} ({n.total})</option>)}
                                </optgroup>
                            )}
                            <optgroup label="WhatsApp oficial (API da Meta)">
                                <option value="VENDAS">Vendas do Saiaê</option>
                                <option value="TODAS">Todas</option>
                                {lojas.filter((l) => l.codigo !== "VENDAS").map((l) => (
                                    <option key={l.codigo} value={l.codigo}>{l.codigo === "SEM-LOJA" ? "Sem loja (orientação)" : `Loja ${l.codigo}`} ({l.total})</option>
                                ))}
                            </optgroup>
                        </select>
                        <select aria-label="Quem está atendendo" value={filtro} onChange={(e) => setFiltro(e.target.value as "" | "ia" | "humano")} className="h-10 rounded-md border border-input bg-background px-2 text-sm">
                            <option value="">Todas</option>
                            <option value="ia">IA atendendo</option>
                            <option value="humano">Com a equipe</option>
                        </select>
                    </div>
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo telefone" className="pl-9" />
                    </div>
                    <div className="max-h-[65vh] divide-y divide-border overflow-y-auto">
                        {lista.length === 0 ? (
                            <p className="p-3 text-sm text-muted-foreground" role="status">
                                {carregando ? "Carregando..." : erroLista ? "Não consegui carregar as conversas. Toque em Atualizar para tentar de novo." : "Nenhuma conversa aqui ainda."}
                            </p>
                        ) : lista.map((c) => (
                            <button key={c.id} type="button" aria-current={selecionada === c.id} onClick={() => setSelecionada(c.id)} className={cn("flex w-full items-start gap-3 px-2 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none", selecionada === c.id && "bg-muted")}>
                                <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{iniciais(c.lead?.nome, c.telefone)}</span>
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center justify-between gap-2">
                                        <span className="truncate text-sm font-medium">{c.lead?.nome ? `${c.lead.nome} · ` : ""}{c.telefone}</span>
                                        <span className="shrink-0 text-xs text-muted-foreground">{quando(c.ultimaMensagemEm)}</span>
                                    </span>
                                    <span className="block truncate text-xs text-muted-foreground">{c.ultima ? `${c.ultima.direcao === "in" ? "Cliente" : "Resposta"}: ${c.ultima.texto}` : "Sem mensagens"}</span>
                                    <span className="mt-1 flex flex-wrap items-center gap-1">
                                        {etiquetaEstado(c.estado)}
                                        {c.lead?.negocio && <Badge variant="secondary">{c.lead.negocio}</Badge>}
                                        {c.lead?.origem === "panfleto" && <Badge variant="secondary">Panfleto</Badge>}
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* conversa */}
                <div className={cn("rounded-lg border border-border", !selecionada && "hidden md:block")}>
                    {!detalhe ? (
                        <p className="p-6 text-sm text-muted-foreground">Escolha uma conversa à esquerda.</p>
                    ) : (
                        <div className="flex h-full flex-col">
                            <div className="space-y-2 border-b border-border p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button variant="ghost" size="sm" className="md:hidden" onClick={() => setSelecionada(null)}><ArrowLeft className="h-4 w-4" /></Button>
                                    <UserRound className="h-5 w-5 text-muted-foreground" />
                                    <span className="font-semibold">{detalhe.lead?.nome ? `${detalhe.lead.nome} · ` : ""}{detalhe.telefone}</span>
                                    {etiquetaEstado(detalhe.estado)}
                                    {detalhe.estado === "humano" && detalhe.pausadaAte && <span className="text-xs text-muted-foreground">até {quando(detalhe.pausadaAte)}</span>}
                                </div>
                                {detalhe.lead && (detalhe.lead.negocio || detalhe.lead.cidade) && (
                                    <p className="text-xs text-muted-foreground">{[detalhe.lead.negocio, detalhe.lead.cidade].filter(Boolean).join(" · ")}</p>
                                )}
                                <div className="flex flex-wrap gap-2">
                                    {detalhe.estado === "ia" ? (
                                        <Button size="sm" variant="outline" onClick={() => mudarEstado("pausar")}><PauseCircle className="h-4 w-4" /> Pausar a IA (12 h)</Button>
                                    ) : (
                                        <Button size="sm" variant="outline" onClick={() => mudarEstado("liberar")}><PlayCircle className="h-4 w-4" /> Devolver à IA</Button>
                                    )}
                                    {!detalhe.somenteLeitura && <Button size="sm" variant="ghost" onClick={apagar}><Trash2 className="h-4 w-4" /> Apagar conversa</Button>}
                                </div>
                            </div>
                            <div className="max-h-[60vh] flex-1 space-y-2 overflow-y-auto p-3">
                                {detalhe.mensagens.map((m, i) => (
                                    <div key={i} className={cn("flex", m.direcao === "out" ? "justify-end" : "justify-start")}>
                                        <div className={cn("max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm", m.direcao === "out" ? "bg-emerald-500/15" : "bg-muted")}>
                                            {m.texto}
                                            <div className="mt-1 text-[10px] text-muted-foreground">{m.autor ?? (m.direcao === "out" ? "IA" : "Cliente")} · {quando(m.criadoEm)}</div>
                                        </div>
                                    </div>
                                ))}
                                <div ref={fim} />
                            </div>
                            <p className="border-t border-border p-2 text-xs text-muted-foreground">
                                {detalhe.somenteLeitura
                                    ? "Conversa completa do número conectado: o que a IA, a equipe (painel ou celular) e o cliente escreveram."
                                    : "Aqui aparecem as mensagens que a IA recebeu e enviou. O que você escreve direto no celular não é gravado nesta tela."}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
