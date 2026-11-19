import { validarExpr, nomeVariavelValido } from "./expressao";
import { destinos, ESPERA_MAX_MS, ESPERA_MIN_MS, MAX_NOS, MAX_TEXTO, SCHEMA_VERSION, TIMEOUT_TOTAL_MS, TIPOS_NO, type Definicao, type No } from "./tipos";

const ID_NO = /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9_-]{1,64}$/;
const texto = (v: unknown, max = MAX_TEXTO): v is string => typeof v === "string" && v.trim() !== "" && v.length <= max;
const opcionalId = (v: unknown) => v === undefined || (typeof v === "string" && ID_NO.test(v));

function validarNo(id: string, n: unknown): string[] {
    if (typeof n !== "object" || n === null) return [`${id}: nó inválido`];
    const x = n as Record<string, unknown>;
    const e = (m: string) => [`${id}: ${m}`];
    if (!(TIPOS_NO as readonly unknown[]).includes(x.type)) return e(`tipo desconhecido (${String(x.type)})`);
    const next = opcionalId(x.next) ? [] : e("next inválido");
    switch (x.type as No["type"]) {
        case "texto":
            return (texto(x.text) ? [] : e("texto vazio ou grande demais")).concat(next);
        case "template":
            return (texto(x.name, 512) && texto(x.languageCode, 16) ? [] : e("template exige name e languageCode"))
                .concat(x.params === undefined || (Array.isArray(x.params) && x.params.length <= 20 && x.params.every((p) => typeof p === "string")) ? [] : e("params inválidos"))
                .concat(next);
        case "condicao":
            return validarExpr(x.expr).map((m) => `${id}: ${m}`).concat(typeof x.then === "string" && typeof x.else === "string" ? [] : e("condição exige then e else"));
        case "espera":
            return (typeof x.ms === "number" && Number.isFinite(x.ms) && x.ms >= ESPERA_MIN_MS && x.ms <= ESPERA_MAX_MS ? [] : e("espera fora do limite")).concat(next);
        case "etiqueta":
            return (texto(x.nome, 100) ? [] : e("nome da etiqueta inválido")).concat(next);
        case "variavel":
            return (nomeVariavelValido(x.nome) ? [] : e("nome de variável inválido"))
                .concat(typeof x.valor === "string" && x.valor.length <= MAX_TEXTO ? [] : e("valor inválido"))
                .concat(next);
        default:
            return [];
    }
}

/**
 * Validador de grafo, executado ao PUBLICAR. Devolve a lista de erros (vazia = publicável):
 * forma do JSON, destinos inexistentes, nós órfãos (inalcançáveis a partir de `start`) e ciclos sem nó de espera
 * (um ciclo só é aceito se passar por `espera`, senão o executor giraria sem parar).
 */
export function validarDefinicao(def: unknown): string[] {
    if (typeof def !== "object" || def === null) return ["definição deve ser um objeto"];
    const d = def as Partial<Definicao>;
    if (d.schemaVersion !== SCHEMA_VERSION) return [`schemaVersion deve ser ${SCHEMA_VERSION}`];
    if (typeof d.nodes !== "object" || d.nodes === null || Array.isArray(d.nodes)) return ["nodes deve ser um objeto"];
    const ids = Object.keys(d.nodes);
    if (ids.length === 0) return ["fluxo sem nós"];
    if (ids.length > MAX_NOS) return [`fluxo com mais de ${MAX_NOS} nós`];
    const erros: string[] = [];
    for (const id of ids) {
        if (!ID_NO.test(id)) erros.push(`${id}: id de nó inválido`);
        else erros.push(...validarNo(id, d.nodes[id]));
    }
    if (typeof d.start !== "string" || !ids.includes(d.start)) erros.push("start inexistente");
    if (erros.length) return erros;

    const nodes = d.nodes as Record<string, No>;
    for (const id of ids) for (const t of destinos(nodes[id])) if (!Object.prototype.hasOwnProperty.call(nodes, t)) erros.push(`${id}: destino inexistente (${t})`);
    if (erros.length) return erros;

    const vistos = new Set<string>();
    const pilha = [d.start as string];
    while (pilha.length) {
        const id = pilha.pop() as string;
        if (vistos.has(id)) continue;
        vistos.add(id);
        pilha.push(...destinos(nodes[id]));
    }
    for (const id of ids) if (!vistos.has(id)) erros.push(`${id}: nó órfão (inalcançável a partir do início)`);

    // ciclo sem espera = ciclo no subgrafo sem os nós de espera
    const estado = new Map<string, 1 | 2>();
    const temCiclo = (id: string): boolean => {
        if (nodes[id].type === "espera") return false;
        if (estado.get(id) === 2) return false;
        if (estado.get(id) === 1) return true;
        estado.set(id, 1);
        for (const t of destinos(nodes[id])) if (temCiclo(t)) return true;
        estado.set(id, 2);
        return false;
    };
    for (const id of ids) if (temCiclo(id)) { erros.push("ciclo sem nó de espera (loop infinito)"); break; }

    // Esperas somadas no caminho mais longo não podem passar do prazo total da execução (senão o fim seria sempre timeout).
    // shortcut: arestas de retorno de ciclo contam 0 (cada volta repete as esperas; o prazo da execução é quem limita voltas).
    const memo = new Map<string, number>();
    const emCurso = new Set<string>();
    const maisLongo = (id: string): number => {
        if (memo.has(id)) return memo.get(id) as number;
        if (emCurso.has(id)) return 0;
        emCurso.add(id);
        const n = nodes[id];
        const r = (n.type === "espera" ? n.ms : 0) + Math.max(0, ...destinos(n).map(maisLongo));
        emCurso.delete(id);
        memo.set(id, r);
        return r;
    };
    if (maisLongo(d.start as string) > TIMEOUT_TOTAL_MS) erros.push("soma das esperas do caminho maior que o prazo total da execução (7 dias)");
    return erros;
}
