import { destinos, type Definicao, type No } from "../tipos";
import { validarDefinicao } from "../validador";

/**
 * Validação para o editor: reaproveita o validador de grafo do motor (o mesmo que roda ao publicar no servidor)
 * e distribui as mensagens por nó, para o canvas marcar cada nó com problema.
 */
export interface ResultadoValidacao {
    ok: boolean;
    /** Mensagens do validador, na ordem original. */
    erros: string[];
    /** Mensagens por id de nó (sem o prefixo "id: "). */
    porNo: Record<string, string[]>;
    /** Mensagens que não pertencem a um nó específico. */
    gerais: string[];
}

/** Nós que fazem parte de algum ciclo sem nó de espera (para marcar no canvas). */
export function nosEmCicloSemEspera(def: Definicao): string[] {
    const nodes = def.nodes;
    const estado = new Map<string, 1 | 2>();
    const pilha: string[] = [];
    const marcados = new Set<string>();
    const visitar = (id: string) => {
        const n = nodes[id] as No | undefined;
        if (!n || n.type === "espera") return;
        if (estado.get(id) === 2) return;
        if (estado.get(id) === 1) { for (const x of pilha.slice(pilha.indexOf(id))) marcados.add(x); return; }
        estado.set(id, 1);
        pilha.push(id);
        for (const t of destinos(n)) visitar(t);
        pilha.pop();
        estado.set(id, 2);
    };
    for (const id of Object.keys(nodes)) visitar(id);
    return [...marcados];
}

export function validarParaEditor(def: unknown): ResultadoValidacao {
    const erros = validarDefinicao(def);
    const porNo: Record<string, string[]> = {};
    const gerais: string[] = [];
    const ids = def && typeof def === "object" && typeof (def as Definicao).nodes === "object" && (def as Definicao).nodes ? Object.keys((def as Definicao).nodes) : [];
    for (const msg of erros) {
        const id = ids.find((i) => msg.startsWith(`${i}: `));
        if (id) (porNo[id] ??= []).push(msg.slice(id.length + 2));
        else gerais.push(msg);
    }
    // O validador dá uma mensagem geral para ciclo; o editor também marca os nós envolvidos.
    if (gerais.some((g) => g.startsWith("ciclo sem nó de espera"))) {
        for (const id of nosEmCicloSemEspera(def as Definicao)) (porNo[id] ??= []).push("faz parte de um ciclo sem espera");
    }
    return { ok: erros.length === 0, erros, porNo, gerais };
}
