/**
 * Estado ia/humano e pausa, comuns às conversas da IA de lojas (ia-atendimento) e da atendente do salão (agente-salao).
 * Só regras puras e o formato dos campos: cada módulo continua gravando na própria tabela.
 */

export const ESTADO_IA = "ia";
export const ESTADO_HUMANO = "humano";

/** A IA está calada nesta conversa? (uma pessoa assumiu ou o responsável foi chamado, e a pausa ainda não venceu) */
export function iaPausada(c: { estado: string; pausadaAte: Date | null }, agora: Date): boolean {
    return c.estado === ESTADO_HUMANO && c.pausadaAte !== null && c.pausadaAte > agora;
}

/** Campos para passar a conversa a uma pessoa até `ate`. `extra` leva campos próprios da tabela (ex.: motivoPausa). */
export function dadosPausar<T extends object = object>(ate: Date, extra?: T) {
    return { estado: ESTADO_HUMANO, pausadaAte: ate, ...extra };
}

/** Campos para devolver a conversa à IA. `extra` leva campos próprios da tabela (ex.: motivoPausa: null). */
export function dadosRetomar<T extends object = object>(extra?: T) {
    return { estado: ESTADO_IA, pausadaAte: null, ...extra };
}
