import { ORIGENS, TIPOS_EVENTO, type Confianca, type EventoResultado, type Origem, type TipoEvento } from "./tipos";

export interface ContagemConfianca { confirmado: number; inferido: number; desconhecido: number; total: number }
export interface LinhaFunil { tipo: TipoEvento; contagem: ContagemConfianca; porOrigem: Record<Origem, ContagemConfianca> }
export interface Funil {
    linhas: LinhaFunil[];
    /** Contatos distintos sem origem identificada (explícito no painel). */
    origemDesconhecida: number;
    /** Contatos distintos considerados (qualquer etapa). */
    contatos: number;
}

const PESO: Record<Confianca, number> = { confirmado: 2, inferido: 1, desconhecido: 0 };
const vazia = (): ContagemConfianca => ({ confirmado: 0, inferido: 0, desconhecido: 0, total: 0 });

/**
 * Consolida eventos em contagens. Regras:
 *  - um contato conta UMA vez por etapa (pessoas, não linhas); com vários eventos do mesmo tipo vale o de maior confiança;
 *  - confirmado, inferido e desconhecido ficam em colunas separadas: o painel mostra as três partes, nunca um total sem rótulo;
 *  - o filtro por origem usa a origem resolvida do contato.
 */
export function consolidarFunil(eventos: EventoResultado[], filtroOrigem?: Origem | null): Funil {
    const melhor = new Map<string, EventoResultado>();
    for (const e of eventos) {
        if (filtroOrigem && e.origem.origem !== filtroOrigem) continue;
        const k = `${e.tipo}|${e.contato}`;
        const atual = melhor.get(k);
        if (!atual || PESO[e.confianca] > PESO[atual.confianca]) melhor.set(k, e);
    }
    const porTipo = new Map<TipoEvento, LinhaFunil>(
        TIPOS_EVENTO.map((tipo) => [tipo, { tipo, contagem: vazia(), porOrigem: Object.fromEntries(ORIGENS.map((o) => [o, vazia()])) as Record<Origem, ContagemConfianca> }]),
    );
    const contatos = new Set<string>();
    const desconhecidos = new Set<string>();
    for (const e of melhor.values()) {
        const linha = porTipo.get(e.tipo)!;
        for (const c of [linha.contagem, linha.porOrigem[e.origem.origem]]) {
            c[e.confianca] += 1;
            c.total += 1;
        }
        contatos.add(e.contato);
        if (e.origem.origem === "desconhecido") desconhecidos.add(e.contato);
    }
    return { linhas: TIPOS_EVENTO.map((t) => porTipo.get(t)!), origemDesconhecida: desconhecidos.size, contatos: contatos.size };
}
