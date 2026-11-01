import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Registra quem mandou cada mensagem que SAIU do CRM: "ia" (atendente) ou "crm" (disparo, agendador, API, painel).
 * Mensagem fromMe sem linha aqui foi uma pessoa escrevendo pelo celular. É só estatística: falhar aqui nunca impede o envio
 * (por isso é disparar-e-esquecer, com try/catch).
 */
export type OrigemMensagem = "ia" | "crm";

export function registrarOrigem(sessionId: string, keyId: string | null | undefined, origem: OrigemMensagem): void {
    if (!keyId) return;
    void (async () => {
        try {
            if (origem === "ia") {
                // "ia" vale mais que "crm": a IA envia pelo mesmo wrapper que registra "crm", então promove a linha
                await prisma.mensagemOrigem.upsert({
                    where: { sessionId_keyId: { sessionId, keyId } },
                    create: { sessionId, keyId, origem },
                    update: { origem },
                });
            } else {
                // nunca sobrescreve uma origem já gravada
                await prisma.mensagemOrigem.createMany({ data: [{ sessionId, keyId, origem }], skipDuplicates: true });
            }
        } catch (e) {
            logger.warn("MensagemOrigem", `não consegui registrar a origem: ${(e as { name?: string })?.name ?? "erro"}`);
        }
    })();
}
