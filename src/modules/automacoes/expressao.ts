import { MAX_PROFUNDIDADE_EXPR, MAX_TEXTO, type Expr, type Operando, type Valor } from "./tipos";

/**
 * Condições e interpolação SEM eval/Function: a condição é um objeto JSON com operadores fixos e a interpolação só
 * troca `{{var}}` por valor de variável. Variáveis são lidas só como propriedade própria de objeto simples, então
 * `__proto__`, `constructor` e afins nunca resolvem.
 */

const PROIBIDOS = new Set(["__proto__", "prototype", "constructor"]);
const NOME_VAR = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export const nomeVariavelValido = (n: unknown): n is string => typeof n === "string" && NOME_VAR.test(n) && !PROIBIDOS.has(n);

export type Vars = Record<string, Valor>;

function ler(vars: Vars, nome: string): Valor | undefined {
    if (!nomeVariavelValido(nome)) return undefined;
    return Object.prototype.hasOwnProperty.call(vars, nome) ? vars[nome] : undefined;
}

const ehVar = (o: unknown): o is { var: string } => typeof o === "object" && o !== null && !Array.isArray(o) && "var" in o;

function valorDe(o: Operando, vars: Vars): Valor | undefined {
    return ehVar(o) ? ler(vars, o.var) : o;
}

function comparar(op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte", a: Valor | undefined, b: Valor | undefined): boolean {
    if (op === "eq") return a === b;
    if (op === "ne") return a !== b;
    if (a === undefined || b === undefined || a === null || b === null) return false;
    // só compara número com número ou texto com texto; tipos diferentes = falso (sem coerção implícita)
    if (typeof a !== typeof b || typeof a === "boolean") return false;
    return op === "gt" ? a > b : op === "gte" ? a >= b : op === "lt" ? a < b : a <= b;
}

/** Avalia a condição. Estrutura inválida lança erro (o validador de publicação já recusa; isto é a segunda barreira). */
export function avaliar(expr: Expr, vars: Vars, nivel = 0): boolean {
    if (nivel > MAX_PROFUNDIDADE_EXPR) throw new Error("condição aninhada demais");
    switch (expr.op) {
        case "eq": case "ne": case "gt": case "gte": case "lt": case "lte":
            return comparar(expr.op, valorDe(expr.a, vars), valorDe(expr.b, vars));
        case "contains": {
            const a = valorDe(expr.a, vars), b = valorDe(expr.b, vars);
            return typeof a === "string" && typeof b === "string" && b !== "" && a.includes(b);
        }
        case "startsWith": {
            const a = valorDe(expr.a, vars), b = valorDe(expr.b, vars);
            return typeof a === "string" && typeof b === "string" && a.startsWith(b);
        }
        case "in": {
            const a = valorDe(expr.a, vars);
            return a !== undefined && Array.isArray(expr.b) && expr.b.includes(a);
        }
        case "exists":
            return ler(vars, expr.a.var) !== undefined;
        case "and":
            return expr.args.every((e) => avaliar(e, vars, nivel + 1));
        case "or":
            return expr.args.some((e) => avaliar(e, vars, nivel + 1));
        case "not":
            return !avaliar(expr.arg, vars, nivel + 1);
        default:
            throw new Error("operador desconhecido");
    }
}

const OPS_BIN = new Set(["eq", "ne", "gt", "gte", "lt", "lte", "contains", "startsWith"]);
const ehValor = (v: unknown): v is Valor => v === null || ["string", "number", "boolean"].includes(typeof v);
const ehOperando = (o: unknown): boolean => ehValor(o) || (ehVar(o) && Object.keys(o).length === 1 && nomeVariavelValido(o.var));

/** Erros de forma da condição (lista vazia = válida). */
export function validarExpr(e: unknown, nivel = 0): string[] {
    if (nivel > MAX_PROFUNDIDADE_EXPR) return ["condição aninhada demais"];
    if (typeof e !== "object" || e === null || Array.isArray(e)) return ["condição deve ser um objeto"];
    const x = e as Record<string, unknown>;
    const op = x.op;
    if (typeof op !== "string") return ["condição sem operador"];
    if (OPS_BIN.has(op)) return ehOperando(x.a) && ehOperando(x.b) ? [] : [`operador ${op}: operandos inválidos`];
    if (op === "in") return ehOperando(x.a) && Array.isArray(x.b) && x.b.length <= 100 && x.b.every(ehValor) ? [] : ["operador in: operandos inválidos"];
    if (op === "exists") return ehVar(x.a) && nomeVariavelValido((x.a as { var: unknown }).var) ? [] : ["operador exists: variável inválida"];
    if (op === "and" || op === "or") {
        if (!Array.isArray(x.args) || x.args.length === 0 || x.args.length > 20) return [`operador ${op}: lista de condições inválida`];
        return x.args.flatMap((a) => validarExpr(a, nivel + 1));
    }
    if (op === "not") return validarExpr(x.arg, nivel + 1);
    return [`operador desconhecido: ${op}`];
}

/**
 * Troca `{{nome}}` pelo valor da variável (texto vazio se não existir). Passada única: o valor inserido NÃO é
 * interpolado de novo, então uma variável com "{{outra}}" no conteúdo não expande nada.
 */
export function interpolar(texto: string, vars: Vars): string {
    return texto
        .replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_m, nome: string) => {
            const v = ler(vars, nome);
            return v === undefined || v === null ? "" : String(v);
        })
        .slice(0, MAX_TEXTO);
}
