import { FOLLOWUP_MAX_HORAS, iaPausada, primeiroNome, textoFollowUp, type ConversaEstado } from "@/modules/agente-salao/estado";
import type { Treino } from "./treino";

/**
 * Follow-up configurável da atendente (sessões com treino publicado): uma sequência de até `maxMensagens` textos do dono,
 * cada um `intervaloHoras` depois da última mensagem da IA ou do follow-up anterior. Regra pura, sem banco nem WhatsApp.
 *
 * Contador: `followUpEnvios` só vale enquanto `followUpEm` está preenchido. A chegada de mensagem da cliente já zera
 * `followUpEm` (agente.ts), então a resposta dela reinicia a sequência sem nenhuma escrita extra no caminho de entrada;
 * a sequência só volta a correr depois que a IA responder de novo.
 */
/**
 * Piso de 12 h entre lembretes: o MAX_POR_DIA da rodada conta conversas, não mensagens, e mensagem não pedida em
 * excesso arrisca bloqueio do número. Com o piso, cada conversa recebe no máximo 2 lembretes por dia.
 */
export const INTERVALO_MIN_HORAS = 12;
export const intervaloEfetivo = (f: Treino["followUp"]) => Math.max(f.intervaloHoras, INTERVALO_MIN_HORAS);

export function proximoFollowUp(args: {
    conv: ConversaEstado & { followUpEnvios: number; nomePerfil?: string | null };
    followUp: Treino["followUp"];
    agora: Date;
    expedienteAberto: boolean;
}): { enviar: boolean; texto?: string } {
    const { conv: c, followUp, agora } = args;
    const nao = { enviar: false };
    if (!c.ultimaInboundAt || !c.ultimaIaAt) return nao; // só para quem escreveu e recebeu resposta da IA
    if (c.estado === "humano" || iaPausada(c, agora)) return nao;
    if (c.ultimaIaAt <= c.ultimaInboundAt) return nao; // a cliente falou por último
    if (c.ultimaHumanoAt && c.ultimaHumanoAt >= c.ultimaIaAt) return nao; // uma pessoa falou depois da IA
    // Troca de motor: followUpEm preenchido com 0 envios é o lembrete do legado; nada mais até a cliente responder.
    if (c.followUpEm && c.followUpEnvios === 0) return nao;
    const envios = c.followUpEm ? c.followUpEnvios : 0;
    if (envios >= Math.min(followUp.maxMensagens, followUp.textos.length)) return nao;
    // Mesmo sinal do legado: só abre sequência se a IA terminou perguntando (conversa encerrada não recebe lembrete).
    if (envios === 0 && !c.ultimaIaPerguntou) return nao;
    const ref = c.followUpEm && c.followUpEm > c.ultimaIaAt ? c.followUpEm : c.ultimaIaAt;
    if (c.ultimaInboundAt >= ref) return nao;
    const horas = (agora.getTime() - ref.getTime()) / 3_600_000;
    const intervalo = intervaloEfetivo(followUp);
    // Teto como no legado: conversa parada há muito tempo não recebe lembrete ao publicar o treino.
    if (horas < intervalo || horas > intervalo + FOLLOWUP_MAX_HORAS) return nao;
    if (!args.expedienteAberto) return nao;
    return { enviar: true, texto: textoFollowUp(primeiroNome(c.nomePerfil), null, followUp.textos[envios]) };
}
