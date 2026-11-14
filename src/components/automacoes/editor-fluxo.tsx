"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type EdgeChange, type NodeChange } from "@xyflow/react";
import { ArrowLeft, CheckCircle2, Loader2, Plus, Rocket, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TIPOS_NO } from "@/modules/automacoes/tipos";
import { definicaoParaGrafo, grafoParaDefinicao, ligacaoPermitida, novoNo, removerNo, type Alca, type Grafo, type TipoNo } from "@/modules/automacoes/editor/grafo";
import { validarParaEditor } from "@/modules/automacoes/editor/validacao";
import { NoFluxo, ROTULOS, type NoRF } from "./no-fluxo";
import { PropriedadesNo } from "./propriedades-no";
import { PainelSimulador } from "./painel-simulador";
import { PainelGatilho } from "./painel-gatilho";

const nodeTypes = { no: NoFluxo };
const ROTULO_ALCA: Record<string, string> = { then: "sim", else: "não" };

interface FluxoApi { id: string; name: string; sessionId: string; status: string; draft: unknown; publishedVersionId: string | null }

function paraRF(g: Grafo): { nodes: NoRF[]; edges: Edge[] } {
    return {
        nodes: g.nodes.map((n) => ({ id: n.id, type: "no", position: n.position, ariaLabel: `${ROTULOS[n.data.type]} ${n.id}`, data: n.data as NoRF["data"] })),
        edges: g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, label: ROTULO_ALCA[e.sourceHandle], markerEnd: { type: "arrowclosed" as const } })),
    };
}

function EditorInterno({ flowId }: { flowId: string }) {
    const [fluxo, setFluxo] = useState<FluxoApi | null>(null);
    const [erroCarga, setErroCarga] = useState<string | null>(null);
    const [nodes, setNodes] = useState<NoRF[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [inicio, setInicio] = useState("");
    const [gatilho, setGatilho] = useState<unknown>(undefined);
    const [selecionado, setSelecionado] = useState<string | null>(null);
    const [sujo, setSujo] = useState(false);
    const [ocupado, setOcupado] = useState<null | "salvar" | "publicar">(null);
    const [errosServidor, setErrosServidor] = useState<string[]>([]);
    const [mostrarErros, setMostrarErros] = useState(false);
    const seq = useRef(0);

    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                const res = await fetch(`/api/automacoes/${flowId}`);
                const j = await res.json().catch(() => ({}));
                if (!res.ok || j.status === false) throw new Error(res.status === 404 ? "Fluxo não encontrado" : j.message || "Falha ao carregar o fluxo");
                if (!vivo) return;
                const f = j.data as FluxoApi;
                const draft = (f.draft ?? {}) as { nodes?: Record<string, unknown>; start?: string };
                const g = definicaoParaGrafo({ schemaVersion: 1, start: draft.start ?? "", nodes: (draft.nodes ?? {}) as never, ...(draft as object) } as never);
                const rf = paraRF(g);
                setFluxo(f); setNodes(rf.nodes); setEdges(rf.edges); setInicio(g.start); setGatilho(g.gatilho);
            } catch (e) {
                if (vivo) setErroCarga(e instanceof Error ? e.message : "Falha ao carregar o fluxo");
            }
        })();
        return () => { vivo = false; };
    }, [flowId]);

    useEffect(() => {
        if (!sujo) return;
        const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
        window.addEventListener("beforeunload", h);
        return () => window.removeEventListener("beforeunload", h);
    }, [sujo]);

    const grafo = useCallback((): Grafo => ({
        nodes: nodes.map((n) => { const { erros: _e, inicio: _i, ...data } = n.data; void _e; void _i; return { id: n.id, position: n.position, data: data as never }; }),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: (e.sourceHandle ?? "next") as Alca })),
        start: inicio, gatilho,
    }), [nodes, edges, inicio, gatilho]);

    const definicao = useMemo(() => grafoParaDefinicao(grafo()), [grafo]);
    const validacao = useMemo(() => validarParaEditor(definicao), [definicao]);

    // marca erros e início nos nós (derivado: não polui o estado de edição)
    const nodesVis = useMemo(() => nodes.map((n) => ({ ...n, data: { ...n.data, erros: mostrarErros ? validacao.porNo[n.id] : undefined, inicio: n.id === inicio } })), [nodes, validacao, inicio, mostrarErros]);

    const aoMudarNos = useCallback((c: NodeChange<NoRF>[]) => {
        setNodes((ns) => applyNodeChanges(c, ns));
        if (c.some((x) => x.type === "remove")) {
            const removidos = c.flatMap((x) => (x.type === "remove" ? [x.id] : []));
            setInicio((i) => (removidos.includes(i) ? "" : i));
            setSelecionado((s) => (s && removidos.includes(s) ? null : s));
        }
        if (c.some((x) => x.type === "position" || x.type === "remove")) setSujo(true);
        const sel = c.find((x) => x.type === "select" && x.selected);
        if (sel && sel.type === "select") setSelecionado(sel.id);
    }, []);
    const aoMudarArestas = useCallback((c: EdgeChange[]) => { setEdges((es) => applyEdgeChanges(c, es)); if (c.some((x) => x.type === "remove")) setSujo(true); }, []);

    const ligar = useCallback((source: string, alca: string, target: string | "") => {
        setEdges((es) => {
            const resto = es.filter((e) => !(e.source === source && e.sourceHandle === alca));
            return target ? [...resto, { id: `${source}:${alca}`, source, target, sourceHandle: alca, label: ROTULO_ALCA[alca], markerEnd: { type: "arrowclosed" as const } }] : resto;
        });
        setSujo(true);
    }, []);
    const aoConectar = useCallback((c: Connection) => { if (c.sourceHandle && c.target) ligar(c.source, c.sourceHandle, c.target); }, [ligar]);
    const conexaoValida = useCallback((c: Connection | Edge) => !!c.sourceHandle && ligacaoPermitida(grafo(), c.source, c.sourceHandle, c.target), [grafo]);

    const adicionar = (tipo: TipoNo) => {
        const g = grafo();
        const n = novoNo(tipo, g, { x: 80 + (seq.current % 5) * 40, y: 80 + g.nodes.length * 20 });
        seq.current++;
        setNodes((ns) => [...ns.map((x) => ({ ...x, selected: false })), { id: n.id, type: "no" as const, position: n.position, ariaLabel: `${ROTULOS[tipo]} ${n.id}`, data: n.data as NoRF["data"], selected: true }]);
        if (!g.start) setInicio(n.id);
        setSelecionado(n.id); setSujo(true);
        toast.success(`${ROTULOS[tipo]} adicionado (${n.id})`);
    };
    const remover = (id: string) => {
        const g = removerNo(grafo(), id);
        const rf = paraRF(g);
        setNodes(rf.nodes); setEdges(rf.edges); setInicio(g.start); setSelecionado(null); setSujo(true);
    };
    const mudarDados = (id: string, patch: Record<string, unknown>) => { setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))); setSujo(true); };

    const salvar = async (): Promise<boolean> => {
        setOcupado("salvar");
        try {
            const res = await fetch(`/api/automacoes/${flowId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: definicao }) });
            const j = await res.json().catch(() => ({}));
            if (!res.ok || j.status === false) throw new Error(j.message || "Falha ao salvar o rascunho");
            setSujo(false);
            toast.success("Rascunho salvo");
            return true;
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao salvar o rascunho");
            return false;
        } finally { setOcupado(null); }
    };

    const publicar = async () => {
        setMostrarErros(true); setErrosServidor([]);
        if (!validacao.ok) { toast.error("Corrija os problemas antes de publicar"); return; }
        if (!(await salvar())) return;
        setOcupado("publicar");
        try {
            const res = await fetch(`/api/automacoes/${flowId}/publicar`, { method: "POST" });
            const j = await res.json().catch(() => ({}));
            if (!res.ok || j.status === false) { setErrosServidor(Array.isArray(j.details) ? j.details : []); throw new Error(j.message === "definicao_invalida" ? "O servidor recusou o fluxo (veja os problemas)" : j.message || "Falha ao publicar"); }
            toast.success(`Versão ${j.data.version} publicada`);
            setFluxo((f) => (f ? { ...f, publishedVersionId: j.data.versionId } : f));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Falha ao publicar");
        } finally { setOcupado(null); }
    };

    if (erroCarga) return <div role="alert" className="space-y-3"><p>{erroCarga}</p><Button asChild variant="outline"><Link href="/dashboard/automacoes">Voltar à lista</Link></Button></div>;
    if (!fluxo) return <p className="flex items-center gap-2 text-muted-foreground" aria-live="polite"><Loader2 className="size-4 animate-spin" aria-hidden /> Carregando o editor...</p>;

    const sel = selecionado ? nodes.find((n) => n.id === selecionado) : undefined;
    const destinos = (id: string): Record<Alca, string | undefined> => ({
        next: edges.find((e) => e.source === id && e.sourceHandle === "next")?.target,
        then: edges.find((e) => e.source === id && e.sourceHandle === "then")?.target,
        else: edges.find((e) => e.source === id && e.sourceHandle === "else")?.target,
    });
    const totalProblemas = validacao.erros.length;

    return (
        <div className="flex h-[calc(100vh-9rem)] min-h-[34rem] flex-col gap-3">
            <header className="flex flex-wrap items-center gap-2">
                <Button asChild variant="ghost" size="sm"><Link href="/dashboard/automacoes"><ArrowLeft aria-hidden /> Fluxos</Link></Button>
                <h1 className="min-w-0 flex-1 truncate text-xl font-bold">{fluxo.name}</h1>
                <span className="text-sm text-muted-foreground" role="status">{sujo ? "Alterações não salvas" : fluxo.publishedVersionId ? "Salvo e publicado" : "Rascunho salvo"}</span>
                <Button size="sm" variant="outline" onClick={() => setMostrarErros(true)}><CheckCircle2 aria-hidden /> Validar</Button>
                <Button size="sm" variant="outline" onClick={salvar} disabled={ocupado !== null}>{ocupado === "salvar" ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} Salvar rascunho</Button>
                <Button size="sm" onClick={publicar} disabled={ocupado !== null}>{ocupado === "publicar" ? <Loader2 className="animate-spin" aria-hidden /> : <Rocket aria-hidden />} Publicar</Button>
            </header>

            <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Adicionar nó">
                <span className="text-sm font-semibold"><Plus className="inline size-4" aria-hidden /> Adicionar:</span>
                {TIPOS_NO.map((t) => <Button key={t} size="sm" variant="glass" onClick={() => adicionar(t)}>{ROTULOS[t]}</Button>)}
            </div>

            <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_22rem]">
                <div className="min-h-[20rem] rounded-xl border bg-card" aria-label="Canvas do fluxo. Use Tab para navegar entre os nós, setas para movê-los e Delete para remover. O painel ao lado liga os nós sem arrastar.">
                    <ReactFlow<NoRF, Edge>
                        nodes={nodesVis} edges={edges} nodeTypes={nodeTypes} onNodesChange={aoMudarNos} onEdgesChange={aoMudarArestas} onConnect={aoConectar}
                        isValidConnection={conexaoValida} onNodeClick={(_, n) => setSelecionado(n.id)} onPaneClick={() => setSelecionado(null)} fitView deleteKeyCode={["Delete", "Backspace"]}
                        ariaLabelConfig={{ "node.a11yDescription.default": "Pressione Enter ou Espaço para selecionar o nó, Delete para removê-lo e as setas para movê-lo.", "node.a11yDescription.keyboardDisabled": "Pressione Enter ou Espaço para selecionar o nó." }}
                    >
                        <Background /><Controls /><MiniMap pannable zoomable aria-label="Mapa do fluxo" />
                    </ReactFlow>
                    {nodes.length === 0 && <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">Fluxo vazio: adicione o primeiro nó acima.</p>}
                </div>

                <aside className="min-h-0 space-y-4 overflow-y-auto rounded-xl border bg-card p-3" aria-label="Painéis do editor">
                    {sel ? (
                        <PropriedadesNo
                            id={sel.id} data={sel.data} erros={mostrarErros ? validacao.porNo[sel.id] ?? [] : []} ehInicio={inicio === sel.id} destinos={destinos(sel.id)}
                            outrosNos={nodes.map((n) => n.id)} onMudar={(p) => mudarDados(sel.id, p)} onLigar={(a, alvo) => ligar(sel.id, a, alvo)} onInicio={() => { setInicio(sel.id); setSujo(true); }} onRemover={() => remover(sel.id)}
                        />
                    ) : <p className="text-sm text-muted-foreground">Selecione um nó no canvas ou na lista abaixo para editar.</p>}

                    <section aria-label="Lista de nós">
                        <h2 className="mb-1 text-sm font-bold">Nós ({nodes.length})</h2>
                        <ul className="space-y-1">
                            {nodes.map((n) => (
                                <li key={n.id}><button type="button" onClick={() => setSelecionado(n.id)} aria-current={selecionado === n.id} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-mustard-300 aria-[current=true]:bg-muted">
                                    <span className="truncate">{ROTULOS[n.data.type]} · {n.id}{n.id === inicio ? " (início)" : ""}</span>
                                    {mostrarErros && validacao.porNo[n.id] && <span className="shrink-0 text-xs font-semibold text-destructive">{validacao.porNo[n.id].length} problema(s)</span>}
                                </button></li>
                            ))}
                        </ul>
                    </section>

                    <section aria-label="Validação" aria-live="polite">
                        <h2 className="mb-1 text-sm font-bold">Validação</h2>
                        {!mostrarErros ? <p className="text-sm text-muted-foreground">Clique em Validar ou Publicar para checar o fluxo.</p>
                            : totalProblemas === 0 && errosServidor.length === 0 ? <p className="text-sm font-semibold">Nenhum problema: o fluxo pode ser publicado.</p>
                                : <ul className="list-disc space-y-0.5 pl-5 text-sm text-destructive">{[...validacao.erros, ...errosServidor.filter((e) => !validacao.erros.includes(e))].map((m) => <li key={m}>{m}</li>)}</ul>}
                    </section>

                    <PainelGatilho valor={gatilho} onMudar={(v) => { setGatilho(v); setSujo(true); }} />
                    <PainelSimulador definicao={definicao} />
                </aside>
            </div>
        </div>
    );
}

export function EditorFluxo({ flowId }: { flowId: string }) {
    return <ReactFlowProvider><EditorInterno flowId={flowId} /></ReactFlowProvider>;
}
