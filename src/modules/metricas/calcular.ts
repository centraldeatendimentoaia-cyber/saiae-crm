import { diaEHora, diaSaoPaulo } from "@/modules/atendimento-comum/tempo";

/**
 * Métricas de atendimento (cálculo puro, sem banco). Entra a lista de mensagens do período (mais um dia antes, para não cortar
 * demandas na borda) e sai o relatório. Todo horário é interpretado no fuso de São Paulo.
 */

export type OrigemResposta = "ia" | "crm" | "humano" | "desconhecido";

export interface MsgMetrica {
    contato: string;
    fromMe: boolean;
    timestamp: Date;
    origem: OrigemResposta;
}

export interface Expediente {
    /** 0 = domingo ... 6 = sábado */
    dias: number[];
    horaAbre: number;
    horaFecha: number;
}

export interface OpcoesMetricas {
    inicio: Date;
    fim: Date;
    expediente: Expediente;
    /** Prazo para a primeira resposta; passou disso = "sem retorno". Padrão 24. */
    horasSemRetorno?: number;
    /** Origem da conversa por contato (mesma chave de `MsgMetrica.contato`). Sem isso, nenhum cliente é de anúncio. */
    origensConversa?: Map<string, "anuncio" | "organico">;
    /** Contatos que já tinham mensagem antes de `inicio`. Quando informado, define "novo"; senão vale a 1ª mensagem da lista. */
    primeiraMensagemAntes?: Set<string>;
    /** Última mensagem de cada contato antes de `inicio`, para detectar reativação. */
    ultimaMensagemAntes?: Map<string, Date>;
    /** Dias sem falar para o retorno contar como reativação. Padrão 30. */
    diasReativacao?: number;
    /** Repassados ao relatório sem alteração. Padrão 0. */
    vendasFechadas?: number;
    passagensParaPessoa?: number;
}

export interface EstatisticaTempo {
    /** Em segundos; null quando não houve nenhuma resposta. */
    media: number | null;
    mediana: number | null;
    p90: number | null;
    amostras: number;
}

export interface MetricasDia {
    dia: string; // AAAA-MM-DD
    recebidas: number;
    demandas: number;
    semRetorno: number;
    tempoMediano: number | null;
}

export interface RelatorioMetricas {
    mensagensRecebidas: number;
    mensagensEnviadas: number;
    contatosUnicos: number;
    contatosNovos: number;
    clientesDeAnuncio: number;
    reativados: number;
    vendasFechadas: number;
    passagensParaPessoa: number;
    demandas: number;
    demandasForaExpediente: number;
    demandasSemRetorno: number;
    demandasPendentes: number;
    tempoPrimeiraResposta: { geral: EstatisticaTempo; dentroExpediente: EstatisticaTempo; foraExpediente: EstatisticaTempo };
    respostasPorOrigem: Record<OrigemResposta, number>;
    /** [dia da semana 0-6][hora 0-23] = mensagens recebidas */
    volumePorDiaHora: number[][];
    porDia: MetricasDia[];
}

export const HORAS_SEM_RETORNO_PADRAO = 24;
export const DIAS_REATIVACAO_PADRAO = 30;

/** Grupos, status, listas de transmissão e canais ficam fora das métricas. */
export function contatoIgnorado(jid: string): boolean {
    return jid.endsWith("@g.us") || jid === "status@broadcast" || jid.endsWith("@broadcast") || jid.endsWith("@newsletter");
}

export function dentroDoExpediente(d: Date, e: Expediente): boolean {
    const { dia, hora } = diaEHora(d);
    return e.dias.includes(dia) && hora >= e.horaAbre && hora < e.horaFecha;
}

export function estatisticaTempo(segundos: number[]): EstatisticaTempo {
    if (segundos.length === 0) return { media: null, mediana: null, p90: null, amostras: 0 };
    const ord = [...segundos].sort((a, b) => a - b);
    const n = ord.length;
    const mediana = n % 2 ? ord[(n - 1) / 2] : (ord[n / 2 - 1] + ord[n / 2]) / 2;
    const p90 = ord[Math.ceil(0.9 * n) - 1]; // posto mais próximo
    const media = ord.reduce((s, v) => s + v, 0) / n;
    return { media: Math.round(media), mediana: Math.round(mediana), p90: Math.round(p90), amostras: n };
}

interface Demanda {
    inicio: Date;
    resposta: Date | null;
    origem: OrigemResposta | null;
}

/** Lista os dias AAAA-MM-DD de `de` até `ate` (inclusive), no calendário. */
function diasEntre(de: string, ate: string): string[] {
    const out: string[] = [];
    const d = new Date(`${de}T12:00:00Z`);
    const fimMs = new Date(`${ate}T12:00:00Z`).getTime();
    while (d.getTime() <= fimMs) {
        out.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
}

export function calcularMetricas(mensagens: MsgMetrica[], opcoes: OpcoesMetricas): RelatorioMetricas {
    const { inicio, fim, expediente } = opcoes;
    const prazoMs = (opcoes.horasSemRetorno ?? HORAS_SEM_RETORNO_PADRAO) * 3_600_000;
    const diasReativacaoMs = (opcoes.diasReativacao ?? DIAS_REATIVACAO_PADRAO) * 86_400_000;
    const naJanela = (d: Date) => d >= inicio && d <= fim;

    // agrupa por contato; o que passou do fim do período não existe para este relatório
    const porContato = new Map<string, MsgMetrica[]>();
    for (const m of mensagens) {
        if (contatoIgnorado(m.contato) || m.timestamp > fim) continue;
        const l = porContato.get(m.contato);
        if (l) l.push(m);
        else porContato.set(m.contato, [m]);
    }

    const volume = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    const respostasPorOrigem: Record<OrigemResposta, number> = { ia: 0, crm: 0, humano: 0, desconhecido: 0 };
    const dias = diasEntre(diaSaoPaulo(inicio), diaSaoPaulo(fim));
    const serie = new Map<string, { recebidas: number; demandas: number; semRetorno: number; tempos: number[] }>(dias.map((d) => [d, { recebidas: 0, demandas: 0, semRetorno: 0, tempos: [] }]));

    let recebidas = 0;
    let enviadas = 0;
    let contatosUnicos = 0;
    let contatosNovos = 0;
    let clientesDeAnuncio = 0;
    let reativados = 0;
    let demandas = 0;
    let foraExpediente = 0;
    let semRetorno = 0;
    let pendentes = 0;
    const tempos = { geral: [] as number[], dentro: [] as number[], fora: [] as number[] };

    for (const [contato, lista] of porContato) {
        lista.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        if (lista.some((m) => naJanela(m.timestamp))) contatosUnicos++;
        const novo = opcoes.primeiraMensagemAntes ? !opcoes.primeiraMensagemAntes.has(contato) && lista.some((m) => naJanela(m.timestamp)) : naJanela(lista[0].timestamp);
        if (novo) {
            contatosNovos++;
            if (opcoes.origensConversa?.get(contato) === "anuncio") clientesDeAnuncio++;
        }
        const ultimaAntes = opcoes.ultimaMensagemAntes?.get(contato);
        if (!novo && ultimaAntes && inicio.getTime() - ultimaAntes.getTime() >= diasReativacaoMs && lista.some((m) => !m.fromMe && naJanela(m.timestamp))) reativados++;

        const todas: Demanda[] = [];
        let atual: Demanda | null = null;
        for (const m of lista) {
            if (naJanela(m.timestamp)) {
                if (m.fromMe) enviadas++;
                else {
                    recebidas++;
                    const { dia, hora } = diaEHora(m.timestamp);
                    volume[dia][hora]++;
                    const s = serie.get(diaSaoPaulo(m.timestamp));
                    if (s) s.recebidas++;
                }
            }
            if (!m.fromMe) {
                // recebida: abre demanda nova, a menos que ainda esteja esperando a nossa primeira resposta
                if (!atual || atual.resposta) {
                    atual = { inicio: m.timestamp, resposta: null, origem: null };
                    todas.push(atual);
                }
            } else if (atual && !atual.resposta) {
                atual.resposta = m.timestamp;
                atual.origem = m.origem;
            }
        }

        for (const d of todas) {
            if (!naJanela(d.inicio)) continue; // demanda de outro período
            demandas++;
            const dentro = dentroDoExpediente(d.inicio, expediente);
            if (!dentro) foraExpediente++;
            const s = serie.get(diaSaoPaulo(d.inicio));
            if (s) s.demandas++;

            const prazo = d.inicio.getTime() + prazoMs;
            if (d.resposta) {
                const seg = (d.resposta.getTime() - d.inicio.getTime()) / 1000;
                tempos.geral.push(seg);
                (dentro ? tempos.dentro : tempos.fora).push(seg);
                s?.tempos.push(seg);
                respostasPorOrigem[d.origem ?? "desconhecido"]++;
                if (d.resposta.getTime() > prazo) {
                    semRetorno++;
                    if (s) s.semRetorno++;
                }
            } else if (prazo <= fim.getTime()) {
                semRetorno++;
                if (s) s.semRetorno++;
            } else {
                pendentes++; // o prazo ainda não venceu no fim do período
            }
        }
    }

    return {
        mensagensRecebidas: recebidas,
        mensagensEnviadas: enviadas,
        contatosUnicos,
        contatosNovos,
        clientesDeAnuncio,
        reativados,
        vendasFechadas: opcoes.vendasFechadas ?? 0,
        passagensParaPessoa: opcoes.passagensParaPessoa ?? 0,
        demandas,
        demandasForaExpediente: foraExpediente,
        demandasSemRetorno: semRetorno,
        demandasPendentes: pendentes,
        tempoPrimeiraResposta: {
            geral: estatisticaTempo(tempos.geral),
            dentroExpediente: estatisticaTempo(tempos.dentro),
            foraExpediente: estatisticaTempo(tempos.fora),
        },
        respostasPorOrigem,
        volumePorDiaHora: volume,
        porDia: dias.map((dia) => {
            const s = serie.get(dia)!;
            return { dia, recebidas: s.recebidas, demandas: s.demandas, semRetorno: s.semRetorno, tempoMediano: estatisticaTempo(s.tempos).mediana };
        }),
    };
}

export interface VariacaoMetrica {
    atual: number;
    anterior: number;
    /** Variação percentual com 1 casa; null quando não há base de comparação (anterior 0 ou tempo sem amostras). */
    variacaoPct: number | null;
}

const CAMPOS_COMPARADOS = [
    "mensagensRecebidas",
    "mensagensEnviadas",
    "contatosUnicos",
    "contatosNovos",
    "clientesDeAnuncio",
    "reativados",
    "vendasFechadas",
    "passagensParaPessoa",
    "demandas",
    "demandasForaExpediente",
    "demandasSemRetorno",
    "demandasPendentes",
] as const;

export function compararPeriodos(atual: RelatorioMetricas, anterior: RelatorioMetricas): Record<string, VariacaoMetrica> {
    const variacao = (a: number, b: number, semBase = false): VariacaoMetrica => ({
        atual: a,
        anterior: b,
        variacaoPct: semBase || b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10,
    });
    const out: Record<string, VariacaoMetrica> = {};
    for (const c of CAMPOS_COMPARADOS) out[c] = variacao(atual[c], anterior[c]);
    const ma = atual.tempoPrimeiraResposta.geral.mediana;
    const mb = anterior.tempoPrimeiraResposta.geral.mediana;
    out.tempoMedianoPrimeiraResposta = variacao(ma ?? 0, mb ?? 0, ma === null || mb === null);
    return out;
}
