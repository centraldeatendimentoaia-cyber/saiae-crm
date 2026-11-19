"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Alca } from "@/modules/automacoes/editor/grafo";
import { ROTULOS, type DadosRF } from "./no-fluxo";

const OPERADORES = [
    ["eq", "é igual a"], ["ne", "é diferente de"], ["gt", "maior que"], ["gte", "maior ou igual a"], ["lt", "menor que"], ["lte", "menor ou igual a"],
    ["contains", "contém"], ["startsWith", "começa com"], ["exists", "existe"],
] as const;
const UNIDADES = [["1000", "segundos"], ["60000", "minutos"], ["3600000", "horas"], ["86400000", "dias"]] as const;

const campo = "w-full rounded-[10px] border border-input bg-card px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-mustard-300";

interface Props {
    id: string;
    data: DadosRF;
    erros: string[];
    ehInicio: boolean;
    destinos: Record<Alca, string | undefined>;
    outrosNos: string[];
    onMudar: (patch: Record<string, unknown>) => void;
    onLigar: (alca: Alca, alvo: string) => void;
    onInicio: () => void;
    onRemover: () => void;
}

type ExprSimples = { op: string; a: { var: string }; b?: string | number | boolean | null };
const simples = (e: unknown): e is ExprSimples => {
    const x = e as ExprSimples | undefined;
    return !!x && OPERADORES.some(([o]) => o === x.op) && typeof x.a === "object" && x.a !== null && "var" in x.a && (x.op === "exists" || x.b === undefined || ["string", "number", "boolean"].includes(typeof x.b) || x.b === null);
};

function Condicao({ data, onMudar }: Pick<Props, "data" | "onMudar">) {
    const [json, setJson] = useState(() => JSON.stringify(data.expr, null, 2));
    const [erroJson, setErroJson] = useState<string | null>(null);
    if (simples(data.expr)) {
        const e = data.expr;
        const set = (p: Partial<ExprSimples>) => onMudar({ expr: e.op === "exists" || p.op === "exists" ? { op: p.op ?? e.op, a: p.a ?? e.a } : { ...e, ...p } });
        return (
            <>
                <div className="space-y-1.5"><Label htmlFor="p-var">Variável</Label><Input id="p-var" value={e.a.var} onChange={(ev) => set({ a: { var: ev.target.value } })} placeholder="nome_da_variavel" /></div>
                <div className="space-y-1.5"><Label htmlFor="p-op">Operador</Label>
                    <select id="p-op" className={campo} value={e.op} onChange={(ev) => set({ op: ev.target.value, b: ev.target.value === "exists" ? undefined : (e.b ?? "") })}>{OPERADORES.map(([o, r]) => <option key={o} value={o}>{r}</option>)}</select></div>
                {e.op !== "exists" && <div className="space-y-1.5"><Label htmlFor="p-b">Valor (texto)</Label><Input id="p-b" value={String(e.b ?? "")} onChange={(ev) => set({ b: ev.target.value })} /></div>}
            </>
        );
    }
    return (
        <div className="space-y-1.5">
            <Label htmlFor="p-json">Condição composta (JSON)</Label>
            <textarea id="p-json" className={`${campo} font-mono text-xs`} rows={8} value={json} aria-invalid={!!erroJson} aria-describedby="p-json-erro"
                onChange={(ev) => { setJson(ev.target.value); try { onMudar({ expr: JSON.parse(ev.target.value) }); setErroJson(null); } catch { setErroJson("JSON inválido: a última versão válida foi mantida"); } }} />
            <p id="p-json-erro" role="status" className="text-xs text-destructive">{erroJson}</p>
        </div>
    );
}

export function PropriedadesNo({ id, data, erros, ehInicio, destinos, outrosNos, onMudar, onLigar, onInicio, onRemover }: Props) {
    const alcas: [Alca, string][] = data.type === "condicao" ? [["then", "Se verdadeiro, vai para"], ["else", "Se falso, vai para"]] : data.type === "fim" || data.type === "transferencia_humana" ? [] : [["next", "Próximo nó"]];
    const ms = typeof data.ms === "number" ? data.ms : 60_000;
    const unidade = [86_400_000, 3_600_000, 60_000, 1000].find((u) => ms % u === 0) ?? 1000;
    return (
        <section aria-label={`Propriedades do nó ${id}`} className="space-y-3">
            <h2 className="text-base font-bold">{ROTULOS[data.type]} <span className="font-mono text-sm font-normal text-muted-foreground">{id}</span></h2>
            {erros.length > 0 && <ul role="alert" className="list-disc space-y-0.5 rounded-lg border border-destructive bg-destructive/5 py-2 pl-6 pr-2 text-sm text-destructive">{erros.map((m) => <li key={m}>{m}</li>)}</ul>}

            {data.type === "texto" && <div className="space-y-1.5"><Label htmlFor="p-text">Mensagem (use {"{{variavel}}"})</Label><textarea id="p-text" className={campo} rows={5} maxLength={4096} value={String(data.text ?? "")} onChange={(e) => onMudar({ text: e.target.value })} /></div>}
            {data.type === "template" && (
                <>
                    <div className="space-y-1.5"><Label htmlFor="p-name">Nome do template aprovado</Label><Input id="p-name" value={String(data.name ?? "")} onChange={(e) => onMudar({ name: e.target.value })} /></div>
                    <div className="space-y-1.5"><Label htmlFor="p-lang">Idioma</Label><Input id="p-lang" value={String(data.languageCode ?? "")} onChange={(e) => onMudar({ languageCode: e.target.value })} /></div>
                    <div className="space-y-1.5"><Label htmlFor="p-params">Parâmetros (um por linha)</Label><textarea id="p-params" className={campo} rows={3} value={((data.params as string[] | undefined) ?? []).join("\n")} onChange={(e) => onMudar({ params: e.target.value === "" ? [] : e.target.value.split("\n") })} /></div>
                </>
            )}
            {data.type === "condicao" && <Condicao key={id} data={data} onMudar={onMudar} />}
            {data.type === "espera" && (
                <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5"><Label htmlFor="p-ms">Tempo</Label><Input id="p-ms" type="number" min={1} value={ms / unidade} onChange={(e) => onMudar({ ms: Math.round(Number(e.target.value) * unidade) })} /></div>
                    <div className="space-y-1.5"><Label htmlFor="p-un">Unidade</Label><select id="p-un" className={campo} value={unidade} onChange={(e) => onMudar({ ms: Math.round((ms / unidade) * Number(e.target.value)) })}>{UNIDADES.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></div>
                </div>
            )}
            {data.type === "etiqueta" && <div className="space-y-1.5"><Label htmlFor="p-tag">Nome da etiqueta</Label><Input id="p-tag" maxLength={100} value={String(data.nome ?? "")} onChange={(e) => onMudar({ nome: e.target.value })} /></div>}
            {data.type === "variavel" && (
                <>
                    <div className="space-y-1.5"><Label htmlFor="p-vn">Nome da variável</Label><Input id="p-vn" value={String(data.nome ?? "")} onChange={(e) => onMudar({ nome: e.target.value })} /></div>
                    <div className="space-y-1.5"><Label htmlFor="p-vv">Valor</Label><Input id="p-vv" value={String(data.valor ?? "")} onChange={(e) => onMudar({ valor: e.target.value })} /></div>
                </>
            )}
            {data.type === "transferencia_humana" && <p className="text-sm text-muted-foreground">Pausa a automação e passa a conversa para uma pessoa. O fluxo termina aqui.</p>}

            {alcas.map(([alca, rotulo]) => (
                <div key={alca} className="space-y-1.5">
                    <Label htmlFor={`p-${alca}`}>{rotulo}</Label>
                    <select id={`p-${alca}`} className={campo} value={destinos[alca] ?? ""} onChange={(e) => onLigar(alca, e.target.value)}>
                        <option value="">{alca === "next" ? "Terminar o fluxo aqui" : "(escolha um nó)"}</option>
                        {outrosNos.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                </div>
            ))}
            <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={onInicio} disabled={ehInicio}>{ehInicio ? "É o início do fluxo" : "Definir como início"}</Button>
                <Button size="sm" variant="destructive" onClick={onRemover}><Trash2 aria-hidden /> Remover nó</Button>
            </div>
        </section>
    );
}
