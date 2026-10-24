import { BoundedTtlMap } from "@/modules/integracao/comanda/state";
import type { MensagemLlm } from "@/modules/ia-atendimento/llm";

/**
 * Estado do bot EM MEMÓRIA (mesmo limite do restante da integração: some se o CRM reiniciar). Depois de um reinício
 * o bot esquece pausas e resumos pendentes: o cliente pede de novo e uma pessoa que tinha assumido pode ser
 * respondida pelo bot até escrever outra vez. shortcut: sem tabela, trocar por banco quando o bot sair do piloto.
 */

export const PAUSA_MS = 12 * 3_600_000;
export const LIMITE_MINUTO = 8;
export const LIMITE_HORA = 60;
const MAX_HISTORICO = 12;
export const RESUMO_VALE_MS = 30 * 60_000;

export interface RascunhoVigente {
    hash: string;
    itens: unknown[];
    totalCentavos: number;
    criadoEm: number;
    /** Chave de idempotência no Sai aê: nasce com o rascunho, estável nas retentativas, nova a cada rascunho. */
    clientUuid: string;
    barracaId: string;
}

export interface ConversaBot {
    historico: { papel: "user" | "assistant"; texto: string }[];
    rascunho: RascunhoVigente | null;
    /** Hash do resumo que o cliente efetivamente recebeu (só definido quando o envio deu certo). */
    hashMostrado: string | null;
    /** A última coisa que o bot mandou foi o resumo: só então um "sim" vale. */
    aguardandoConfirmacao: boolean;
    soLink: boolean;
}

export function criarEstadoBot(agora: () => number = Date.now) {
    const vistos = new BoundedTtlMap<true>(20_000, 3_600_000, agora);
    const pausas = new BoundedTtlMap<true>(20_000, PAUSA_MS, agora);
    const links = new BoundedTtlMap<true>(20_000, 24 * 3_600_000, agora);
    const conversas = new BoundedTtlMap<ConversaBot>(5_000, 24 * 3_600_000, agora);
    const hits = new BoundedTtlMap<number[]>(20_000, 3_600_000, agora);
    const chave = (sessionId: string, contactKey: string) => `${sessionId}:${contactKey}`;

    return {
        /** true se o messageId já foi tratado (e marca como tratado). */
        jaTratada(sessionId: string, messageId: string): boolean {
            const k = chave(sessionId, messageId);
            if (vistos.has(k)) return true;
            vistos.set(k, true);
            return false;
        },
        /** Cala o bot neste contato por 12 h (o TTL do mapa). */
        pausar: (sessionId: string, contactKey: string) => {
            pausas.set(chave(sessionId, contactKey), true);
        },
        pausada: (sessionId: string, contactKey: string) => pausas.has(chave(sessionId, contactKey)),
        /** Registra uma mensagem e devolve true se passou do limite (8/min, 60/h). */
        estourouLimite(sessionId: string, contactKey: string): boolean {
            const k = chave(sessionId, contactKey);
            const t = agora();
            const lista = (hits.get(k) ?? []).filter((x) => t - x < 3_600_000);
            lista.push(t);
            hits.set(k, lista);
            return lista.length > LIMITE_HORA || lista.filter((x) => t - x < 60_000).length > LIMITE_MINUTO;
        },
        /** true se ainda não mandou o link a este contato hoje (e marca como mandado). `dia` = AAAA-MM-DD de São Paulo. */
        primeiroLinkDoDia(sessionId: string, contactKey: string, dia: string): boolean {
            const k = `${chave(sessionId, contactKey)}:${dia}`;
            if (links.has(k)) return false;
            links.set(k, true);
            return true;
        },
        conversa: (sessionId: string, contactKey: string) => conversas.get(chave(sessionId, contactKey)),
        salvarConversa(sessionId: string, contactKey: string, c: ConversaBot) {
            c.historico = c.historico.slice(-MAX_HISTORICO);
            conversas.set(chave(sessionId, contactKey), c);
        },
    };
}

export type EstadoBot = ReturnType<typeof criarEstadoBot>;
export const estadoPadrao: EstadoBot = criarEstadoBot();

export const paraMensagensLlm = (c: ConversaBot): MensagemLlm[] => c.historico.map((h) => ({ papel: h.papel, texto: h.texto }));
