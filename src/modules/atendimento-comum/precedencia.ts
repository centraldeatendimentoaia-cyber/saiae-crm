import { ESTADO_HUMANO, iaPausada } from "./pausa";

/**
 * Precedência do atendimento: quem pode enviar AGORA numa conversa. Regra única (antes espalhada em `iaPausada`/`pausadaAgora`
 * e nas checagens de cada módulo). Não muda o comportamento existente, só o centraliza:
 *
 *   1. Pessoa (humano) vence a IA e a automação: com `estado = humano` e pausa ainda válida, só a pessoa envia.
 *   2. Pausa vencida (12 h na IA das lojas, `pausaHoras` no agente do salão): a IA volta sozinha (`retomar: true`: quem
 *      chamou deve gravar a volta ao estado "ia").
 *   3. Opt-out do cliente vence tudo, inclusive a pessoa quando o envio é automático (campanha, aviso, follow-up).
 *   4. Vale igual para IA e para automação de conversa (follow-up, disparo): ambas respeitam a pausa humana. O aviso de
 *      pedido NÃO passa por aqui: é transacional, não é conversa.
 */
export type MotivoBloqueio = "humano_assumiu" | "optout";

export type Decisao = { pode: true; retomar: boolean } | { pode: false; motivo: MotivoBloqueio };

export function quemPodeEnviar(
    conversa: { estado: string; pausadaAte: Date | null },
    agora: Date,
    opcoes: { optOut?: boolean } = {}
): Decisao {
    if (opcoes.optOut) return { pode: false, motivo: "optout" };
    if (iaPausada(conversa, agora)) return { pode: false, motivo: "humano_assumiu" };
    return { pode: true, retomar: conversa.estado === ESTADO_HUMANO }; // humano com pausa vencida: a IA retoma
}
