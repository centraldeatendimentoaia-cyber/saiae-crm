import { destinos, SCHEMA_VERSION, TIPOS_NO, type Definicao, type No } from "../tipos";

/**
 * Conversão entre o JSON do motor (`Definicao`) e o grafo do editor visual. Módulo puro (sem React, sem rede):
 * a biblioteca de canvas só desenha o que sai daqui. Ida e volta é idempotente: definição -> grafo -> definição
 * devolve a mesma definição (inclusive posições e gatilho, guardados em campos extras que o validador do motor ignora).
 */

export type TipoNo = (typeof TIPOS_NO)[number];
export type Alca = "next" | "then" | "else";

/** Propriedades do nó sem as ligações (as ligações vivem nas arestas). */
export type DadosNo = Omit<Extract<No, { type: TipoNo }>, "next" | "then" | "else"> & { type: TipoNo };

export interface Posicao { x: number; y: number }
export interface NoGrafo { id: string; position: Posicao; data: Record<string, unknown> & { type: TipoNo } }
export interface ArestaGrafo { id: string; source: string; target: string; sourceHandle: Alca }
export interface Grafo { nodes: NoGrafo[]; edges: ArestaGrafo[]; start: string; gatilho?: unknown }

/** Campos extras guardados na definição (o validador do motor ignora o que não conhece). */
export type DefinicaoEditor = Definicao & { layout?: Record<string, Posicao>; trigger?: unknown };

const LIGACOES = ["next", "then", "else"] as const;
const ESPACO_X = 260;
const ESPACO_Y = 150;

/** Posição automática por camadas (distância do início), para definições sem `layout`. */
function posicoesAutomaticas(def: Definicao): Record<string, Posicao> {
    const nivel = new Map<string, number>();
    const fila: string[] = [];
    if (def.start && Object.prototype.hasOwnProperty.call(def.nodes, def.start)) { nivel.set(def.start, 0); fila.push(def.start); }
    while (fila.length) {
        const id = fila.shift() as string;
        for (const t of destinos(def.nodes[id])) {
            if (!nivel.has(t) && Object.prototype.hasOwnProperty.call(def.nodes, t)) { nivel.set(t, (nivel.get(id) as number) + 1); fila.push(t); }
        }
    }
    const porNivel = new Map<number, number>();
    const pos: Record<string, Posicao> = {};
    let extra = Math.max(-1, ...nivel.values()) + 1;
    for (const id of Object.keys(def.nodes)) {
        const n = nivel.get(id) ?? extra++; // órfãos vão para camadas abaixo, visíveis para o usuário corrigir
        const col = porNivel.get(n) ?? 0;
        porNivel.set(n, col + 1);
        pos[id] = { x: col * ESPACO_X, y: n * ESPACO_Y };
    }
    return pos;
}

export function definicaoParaGrafo(def: Definicao | DefinicaoEditor): Grafo {
    const layout = (def as DefinicaoEditor).layout;
    const auto = posicoesAutomaticas(def);
    const nodes: NoGrafo[] = [];
    const edges: ArestaGrafo[] = [];
    for (const [id, no] of Object.entries(def.nodes)) {
        const dados: Record<string, unknown> = { ...no };
        for (const l of LIGACOES) delete dados[l];
        nodes.push({ id, position: layout?.[id] ?? auto[id], data: dados as NoGrafo["data"] });
        for (const l of LIGACOES) {
            const alvo = (no as Record<string, unknown>)[l];
            if (typeof alvo === "string") edges.push({ id: `${id}:${l}`, source: id, target: alvo, sourceHandle: l });
        }
    }
    const g: Grafo = { nodes, edges, start: def.start };
    const trigger = (def as DefinicaoEditor).trigger;
    if (trigger !== undefined) g.gatilho = trigger;
    return g;
}

export function grafoParaDefinicao(g: Grafo): DefinicaoEditor {
    const nodes: Record<string, No> = {};
    const layout: Record<string, Posicao> = {};
    for (const n of g.nodes) {
        nodes[n.id] = { ...n.data } as unknown as No;
        layout[n.id] = { x: n.position.x, y: n.position.y };
    }
    // Uma saída por alça: a última aresta vence se o usuário ligar duas vezes a mesma alça.
    for (const e of g.edges) {
        const no = nodes[e.source];
        if (!no) continue;
        const permitidas = no.type === "condicao" ? ["then", "else"] : no.type === "fim" || no.type === "transferencia_humana" ? [] : ["next"];
        if (permitidas.includes(e.sourceHandle)) (no as unknown as Record<string, string>)[e.sourceHandle] = e.target;
    }
    const def: DefinicaoEditor = { schemaVersion: SCHEMA_VERSION, start: g.start, nodes, layout };
    if (g.gatilho !== undefined) def.trigger = g.gatilho;
    return def;
}

/** Define o início; devolve grafo novo (imutável). */
export const comInicio = (g: Grafo, id: string): Grafo => ({ ...g, start: id });

/** Remove um nó e as arestas que o tocam; se era o início, o início fica vazio (o validador acusa). */
export function removerNo(g: Grafo, id: string): Grafo {
    return {
        ...g,
        nodes: g.nodes.filter((n) => n.id !== id),
        edges: g.edges.filter((e) => e.source !== id && e.target !== id),
        start: g.start === id ? "" : g.start,
    };
}

const PADROES: Record<TipoNo, Record<string, unknown>> = {
    texto: { text: "" },
    template: { name: "", languageCode: "pt_BR", params: [] },
    condicao: { expr: { op: "eq", a: { var: "" }, b: "" } },
    espera: { ms: 60_000 },
    etiqueta: { nome: "" },
    variavel: { nome: "", valor: "" },
    transferencia_humana: {},
    fim: {},
};

export function novoNo(tipo: TipoNo, g: Grafo, posicao: Posicao): NoGrafo {
    let i = g.nodes.length + 1;
    while (g.nodes.some((n) => n.id === `${tipo}_${i}`)) i++;
    return { id: `${tipo}_${i}`, position: posicao, data: { type: tipo, ...structuredClone(PADROES[tipo]) } as NoGrafo["data"] };
}

/** Só aceita ligar alças que o tipo do nó tem e destinos que existem (ciclos o validador acusa ao publicar). */
export function ligacaoPermitida(g: Grafo, source: string, handle: string, target: string): boolean {
    const no = g.nodes.find((n) => n.id === source);
    if (!no || !g.nodes.some((n) => n.id === target)) return false;
    if (no.data.type === "condicao") return handle === "then" || handle === "else";
    if (no.data.type === "fim" || no.data.type === "transferencia_humana") return false;
    return handle === "next";
}
