"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Flag, Hourglass, MessageSquare, FileText, GitBranch, Tag, Variable, UserRound } from "lucide-react";
import type { TipoNo } from "@/modules/automacoes/editor/grafo";

export const ROTULOS: Record<TipoNo, string> = {
    texto: "Texto", template: "Template", condicao: "Condição", espera: "Espera", etiqueta: "Etiqueta",
    variavel: "Variável", transferencia_humana: "Transferir para humano", fim: "Fim",
};
const ICONES: Record<TipoNo, React.ElementType> = {
    texto: MessageSquare, template: FileText, condicao: GitBranch, espera: Hourglass, etiqueta: Tag,
    variavel: Variable, transferencia_humana: UserRound, fim: Flag,
};

export type DadosRF = { type: TipoNo; erros?: string[]; inicio?: boolean } & Record<string, unknown>;
export type NoRF = Node<DadosRF, "no">;

export function formatarEspera(ms: number): string {
    if (ms % 86_400_000 === 0) return `${ms / 86_400_000} d`;
    if (ms % 3_600_000 === 0) return `${ms / 3_600_000} h`;
    if (ms % 60_000 === 0) return `${ms / 60_000} min`;
    return `${ms / 1000} s`;
}

export function resumo(d: DadosRF): string {
    switch (d.type) {
        case "texto": return String(d.text ?? "").slice(0, 60) || "(vazio)";
        case "template": return String(d.name ?? "") || "(sem nome)";
        case "condicao": { const e = d.expr as { op?: string; a?: { var?: string } } | undefined; return e?.op ? `${e.op}${e.a && typeof e.a === "object" && "var" in e.a ? ` ${e.a.var}` : ""}` : "(sem condição)"; }
        case "espera": return typeof d.ms === "number" ? formatarEspera(d.ms) : "(sem tempo)";
        case "etiqueta": return String(d.nome ?? "") || "(sem nome)";
        case "variavel": return `${String(d.nome ?? "")} = ${String(d.valor ?? "")}`.slice(0, 60);
        default: return "";
    }
}

/** Cartão do nó. A cor sozinha não indica erro: há ícone e texto ("N problema(s)") além da borda. */
export function NoFluxo({ id, data, selected }: NodeProps<NoRF>) {
    const Icone = ICONES[data.type];
    const erros = data.erros ?? [];
    return (
        <div className={`min-w-44 max-w-60 rounded-xl border-2 bg-card px-3 py-2 text-sm shadow-sm ${erros.length ? "border-destructive" : selected ? "border-foreground" : "border-border"}`}>
            <Handle type="target" position={Position.Top} aria-label={`Entrada de ${id}`} />
            <div className="flex items-center gap-2 font-semibold"><Icone className="size-4 shrink-0" aria-hidden /> <span className="truncate">{ROTULOS[data.type]}</span>{data.inicio && <span className="ml-auto rounded bg-brand px-1.5 text-xs text-brand-foreground">Início</span>}</div>
            <div className="truncate text-xs text-muted-foreground">{id}</div>
            {resumo(data) && <div className="mt-1 break-words text-xs">{resumo(data)}</div>}
            {erros.length > 0 && <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-destructive"><AlertTriangle className="size-3.5" aria-hidden /> {erros.length} problema{erros.length > 1 ? "s" : ""}</div>}
            {data.type === "condicao" ? (
                <>
                    <Handle type="source" id="then" position={Position.Bottom} style={{ left: "30%" }} aria-label={`Saída "sim" de ${id}`} />
                    <Handle type="source" id="else" position={Position.Bottom} style={{ left: "70%" }} aria-label={`Saída "não" de ${id}`} />
                </>
            ) : data.type !== "fim" && data.type !== "transferencia_humana" ? (
                <Handle type="source" id="next" position={Position.Bottom} aria-label={`Saída de ${id}`} />
            ) : null}
        </div>
    );
}
