import type { WAMessage } from "@whiskeysockets/baileys";
import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Origem da conversa: "anuncio" (clique para WhatsApp do Meta) ou "organico". Vale a primeira mensagem recebida do contato.
 * É só estatística: falhar aqui nunca impede salvar a mensagem (por isso é disparar-e-esquecer, com try/catch).
 */
export type OrigemConversa = "anuncio" | "organico";

/** Anúncio = `externalAdReply` ou `conversionSource` no contextInfo (API oficial: `referral`, ainda não ligado). */
export function origemDaMensagem(msg: WAMessage): OrigemConversa {
    const c = normalizeMessageContent(msg.message);
    const ctx = c?.extendedTextMessage?.contextInfo ?? c?.imageMessage?.contextInfo ?? c?.videoMessage?.contextInfo;
    return ctx?.externalAdReply || ctx?.conversionSource ? "anuncio" : "organico";
}

export function registrarOrigemConversa(sessionId: string, jid: string, origem: OrigemConversa): void {
    void (async () => {
        try {
            // nunca sobrescreve: a primeira origem gravada vale
            await prisma.conversaOrigem.createMany({ data: [{ sessionId, jid, origem }], skipDuplicates: true });
        } catch (e) {
            logger.warn("ConversaOrigem", `não consegui registrar a origem: ${(e as { name?: string })?.name ?? "erro"}`);
        }
    })();
}

const JANELA_AO_VIVO_MS = 10 * 60_000;
interface PrimeiraRecebida { fromMe: boolean; triggerWebhook: boolean; timestamp: Date; agora: number }

/** Checagem barata (sem banco): só mensagem recebida, ao vivo (não histórico) e recente pode ser a primeira de um contato novo. */
export const podeSerPrimeiraRecebida = (p: PrimeiraRecebida): boolean =>
    !p.fromMe && p.triggerWebhook && p.agora - p.timestamp.getTime() < JANELA_AO_VIVO_MS;

/** `recebidas` = mensagens recebidas do contato já salvas, contando a atual. */
export const ehPrimeiraRecebida = (p: PrimeiraRecebida & { recebidas: number }): boolean => podeSerPrimeiraRecebida(p) && p.recebidas === 1;
