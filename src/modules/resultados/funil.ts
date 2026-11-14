import { ORIGENS, TIPOS_EVENTO, type Confianca, type EventoResultado, type Origem, type TipoEvento } from "./tipos";

export interface ContagemConfianca { confirmado: number; inferido: number; desconhecido: number; total: number }
/** Uma linha por origem E confiança da origem: "anúncio (confirmada)" e "anúncio (inferida)" nunca se misturam. */
export interface LinhaOrigem { origem: Origem; confiancaOrigem: Confianca; contagem: ContagemConfianca }
export interface LinhaFunil { tipo: TipoEvento; contagem: ContagemConfianca; porOrigem: LinhaOrigem[] }
export interface Funil {
    linhas: LinhaFunil[];
    /** Contatos distintos sem origem identificada (explícito no painel). */
    origemDesconhecida: number;
    /** Contatos distintos considerados (qualquer etapa). */
    contatos: number;
    /** Contatos com evento importado e nenhuma conversa registrada na sessão (preenchido por quem carrega; 0 se não informado). */
    importadosSemConversa: number;
}

const PESO: Record<Confianca, number> = { confirmado: 2, inferido: 1, desconhecido: 0 };
const CONFIANCAS: Confianca[] = ["confirmado", "inferido", "desconhecido"];
const vazia = (): ContagemConfianca => ({ confirmado: 0, inferido: 0, desconhecido: 0, total: 0 });

/**
 * Consolida eventos em contagens. Regras:
 *  - um contato conta UMA vez por etapa (pessoas, não linhas); com vários eventos do mesmo tipo vale o de maior confiança;
 *  - confirmado, inferido e desconhecido (do EVENTO) ficam em colunas separadas: o painel mostra as três partes, nunca um total sem rótulo;
 *  - a divisão por origem usa origem + confiança da ORIGEM resolvida do contato (o selo do evento não vale para a origem);
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
    const porTipo = new Map<TipoEvento, { contagem: ContagemConfianca; origens: Map<string, LinhaOrigem> }>(TIPOS_EVENTO.map((tipo) => [tipo, { contagem: vazia(), origens: new Map() }]));
    const contatos = new Set<string>();
    const desconhecidos = new Set<string>();
    for (const e of melhor.values()) {
        const linha = porTipo.get(e.tipo)!;
        const chave = `${e.origem.origem}|${e.origem.confianca}`;
        let lo = linha.origens.get(chave);
        if (!lo) { lo = { origem: e.origem.origem, confiancaOrigem: e.origem.confianca, contagem: vazia() }; linha.origens.set(chave, lo); }
        for (const c of [linha.contagem, lo.contagem]) {
            c[e.confianca] += 1;
            c.total += 1;
        }
        contatos.add(e.contato);
        if (e.origem.origem === "desconhecido") desconhecidos.add(e.contato);
    }
    const ordem = (l: LinhaOrigem) => ORIGENS.indexOf(l.origem) * 3 + CONFIANCAS.indexOf(l.confiancaOrigem);
    return {
        linhas: TIPOS_EVENTO.map((tipo) => ({ tipo, contagem: porTipo.get(tipo)!.contagem, porOrigem: [...porTipo.get(tipo)!.origens.values()].sort((a, b) => ordem(a) - ordem(b)) })),
        origemDesconhecida: desconhecidos.size,
        contatos: contatos.size,
        importadosSemConversa: 0,
    };
}
