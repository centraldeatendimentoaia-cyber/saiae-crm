import { TZ_SAO_PAULO } from "@/modules/atendimento-comum/tempo";
import { errorMessage } from "@/lib/errors";
import cron from "node-cron";
import { personalizeFor } from "@/lib/personalize";
import cronParser from "cron-parser";
import { prisma } from "@/lib/prisma";
import { getProvider } from "@/modules/whatsapp/provider";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider/types";
import { logger } from "./logger";
import { assertCanSend, recordMessages } from "@/lib/plans";
import { isOptedOut } from "@/lib/optout";
import { onlyInteractedEnabled, hasInteracted, NO_INTERACTION_ERROR } from "@/lib/interaction";
import { startRetention } from "@/lib/retention";
import { startFollowUps } from "@/modules/agente-salao/followup";
import { resolveMedia } from "@/lib/media";
import { startSocialScheduler } from "@/modules/social/scheduler";
import { startAutomacoes } from "@/modules/automacoes/worker";
import { withJobLock, registrarInstancia, outrasInstanciasVivas } from "@/lib/job-lock";
import { classifySendFailure, backoffMs, maskPersonalData, MAX_ATTEMPTS } from "@/lib/send-failure";
import { getSafeMode, safeGate, humanDelayMs, batchPauseMs } from "@/lib/safe-mode";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let running = false; // evita duas rodadas ao mesmo tempo

/** Ocorrência atrasada além disto não é enviada (texto velho sairia fora de hora): fica registrada como "missed". */
export const MAX_ATRASO_MS = 6 * 3_600_000;
/** Reserva "claimed" sem desfecho há mais que isto = processo morreu no meio do envio; vira "unknown" (nunca reenvia). */
export const CLAIM_EXPIRA_MS = 10 * 60_000;
const MAX_OCORRENCIAS_ATRASADAS = 500;
const AVISO_ATRASADA = "Ocorrência atrasada (servidor parado ou sessão desconectada) e fora do prazo de envio; não enviada.";
const AVISO_SUBSTITUIDA = "Ocorrência atrasada substituída pela mais recente; não enviada.";
const AVISO_INTERROMPIDA = "Processo interrompido entre reservar e confirmar o envio. Pode ou não ter saído; NÃO foi reenviada. Confira na conversa.";

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === "P2002";
const shortError = (e: unknown) => maskPersonalData(errorMessage(e, "erro")).slice(0, 500);

/** Avisa o dono no painel de uma perda que não pode ficar em silêncio. Nunca lança (aviso falho só vai para o log). */
async function notifyOwner(userId: string, title: string, message: string) {
    await prisma.notification
        .create({ data: { userId, type: "WARNING", title, message } })
        .catch((e) => logger.warn("Cron", `Aviso ao dono não criado: ${e instanceof Error ? e.name : "erro"}`));
}

/** Ocorrências vencidas de uma mensagem recorrente, a partir de sendAt, e a próxima ocorrência futura. */
function dueOccurrences(expr: string, sendAt: Date, now: Date): { due: Date[]; next: Date } {
    const it = cronParser.parse(expr, { tz: TZ_SAO_PAULO, currentDate: sendAt });
    const due = [sendAt];
    for (let i = 0; i < MAX_OCORRENCIAS_ATRASADAS; i++) {
        const n = it.next().toDate();
        if (n.getTime() > now.getTime()) return { due, next: n };
        due.push(n);
    }
    return { due, next: cronParser.parse(expr, { tz: TZ_SAO_PAULO, currentDate: now }).next().toDate() };
}

/** Reservas que ficaram sem desfecho (processo caiu): marca "unknown" e encerra a mensagem única como FAILED. */
async function reconcileStaleClaims(now: Date) {
    const stale = await prisma.scheduledMessageAttempt.findMany({
        where: { status: "claimed", claimedAt: { lt: new Date(now.getTime() - CLAIM_EXPIRA_MS) } },
        select: { id: true, scheduledMessageId: true },
        take: 100,
    });
    for (const a of stale) {
        const r = await prisma.scheduledMessageAttempt.updateMany({
            where: { id: a.id, status: "claimed" },
            data: { status: "unknown", failureClass: "unknown", error: AVISO_INTERROMPIDA, finishedAt: now },
        });
        if (r.count !== 1) continue;
        // mensagem única: não reenvia; recorrente já avançou (ou avança no próximo ciclo, ver tratamento de P2002)
        await prisma.scheduledMessage.updateMany({ where: { id: a.scheduledMessageId, cronExpression: null, status: "PENDING" }, data: { status: "FAILED" } });
        logger.warn("Cron", `Mensagem ${a.scheduledMessageId}: envio sem desfecho, marcado como resultado desconhecido`);
    }
}

const loadDue = (now: Date) =>
    prisma.scheduledMessage.findMany({ where: { status: "PENDING", sendAt: { lte: now } }, include: { session: true } });
type DueMsg = Awaited<ReturnType<typeof loadDue>>[number];

/**
 * Processa uma mensagem vencida: registra as ocorrências perdidas, reserva (claim atômico) a ocorrência a enviar,
 * avança a série e só então envia. Devolve true se enviou (para o espaçamento entre envios).
 */
async function processDue(msg: DueMsg, now: Date, provider: WhatsAppProvider): Promise<boolean> {
    const recurring = !!msg.cronExpression;
    let due: Date[] = [msg.sendAt];
    let next: Date | null = null;
    if (recurring) {
        try {
            ({ due, next } = dueOccurrences(msg.cronExpression!, msg.sendAt, now));
        } catch (e) {
            // expressão inválida: a série não tem como continuar. Fica FAILED, visível, em vez de repetir o erro todo minuto.
            await prisma.scheduledMessageAttempt.createMany({ data: [{ scheduledMessageId: msg.id, occurrenceAt: msg.sendAt, status: "failed", failureClass: "permanent", error: `Expressão de recorrência inválida: ${shortError(e)}`, finishedAt: now }], skipDuplicates: true });
            await prisma.scheduledMessage.updateMany({ where: { id: msg.id, status: "PENDING" }, data: { status: "FAILED" } });
            return false;
        }
    }
    const target = due[due.length - 1];
    const tooLate = now.getTime() - target.getTime() > MAX_ATRASO_MS;

    // Ocorrências perdidas (todas menos a que vai ser enviada): registradas com motivo, nunca descartadas em silêncio.
    const skipped = tooLate ? due : due.slice(0, -1);
    if (skipped.length) {
        await prisma.scheduledMessageAttempt.createMany({
            data: skipped.map((at) => ({ scheduledMessageId: msg.id, occurrenceAt: at, status: "missed", error: tooLate ? AVISO_ATRASADA : AVISO_SUBSTITUIDA, finishedAt: now })),
            skipDuplicates: true,
        });
    }
    if (tooLate) {
        const r = await prisma.scheduledMessage.updateMany({
            where: { id: msg.id, status: "PENDING", sendAt: msg.sendAt },
            data: recurring ? { sendAt: next! } : { status: "FAILED" },
        });
        // mensagem única perdida: uma notificação por ocorrência (o updateMany condicional só acerta uma vez)
        if (!recurring && r.count === 1) await notifyOwner(msg.session.userId, "Mensagem agendada não enviada", "Uma mensagem agendada passou do prazo de envio (mais de 6 h de atraso) e não foi enviada. Confira em Mensagens agendadas e reagende se precisar.");
        return false;
    }

    // Claim atômico: só quem cria a linha (única por mensagem + ocorrência) envia esta ocorrência.
    try {
        await prisma.scheduledMessageAttempt.create({ data: { scheduledMessageId: msg.id, occurrenceAt: target, status: "claimed" } });
    } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        const prev = await prisma.scheduledMessageAttempt.findUnique({
            where: { scheduledMessageId_occurrenceAt: { scheduledMessageId: msg.id, occurrenceAt: target } },
            select: { status: true },
        });
        // Outra instância está enviando agora: não mexe. Já tem desfecho (ou a reserva venceu e foi reconciliada): só avança.
        if (prev?.status === "claimed") return false;
        if (recurring) await prisma.scheduledMessage.updateMany({ where: { id: msg.id, status: "PENDING", sendAt: msg.sendAt }, data: { sendAt: next! } });
        else await prisma.scheduledMessage.updateMany({ where: { id: msg.id, status: "PENDING" }, data: { status: prev?.status === "sent" ? "SENT" : "FAILED" } });
        return false;
    }
    const finish = (status: string, extra: Record<string, unknown> = {}) =>
        prisma.scheduledMessageAttempt.updateMany({
            where: { scheduledMessageId: msg.id, occurrenceAt: target, status: "claimed" },
            data: { status, finishedAt: new Date(), ...extra },
        });

    if (recurring) {
        const moved = await prisma.scheduledMessage.updateMany({ where: { id: msg.id, status: "PENDING", sendAt: msg.sendAt }, data: { sendAt: next! } });
        if (moved.count !== 1) {
            await finish("missed", { error: "Mensagem alterada ou removida durante o processamento; não enviada." });
            return false;
        }
    }

    let sendAttempted = false; // a partir daqui o provedor foi chamado: erro comum pode ter saído
    try {
        // Plano: conta suspensa ou sem cota não envia
        try {
            await assertCanSend(msg.session.userId, 1);
        } catch (planErr) {
            logger.warn("Cron", `Plano bloqueou o envio ${msg.id}: ${errorMessage(planErr)}`);
            await finish("failed", { failureClass: "policy", error: `Plano bloqueou o envio: ${shortError(planErr)}` });
            if (!recurring) await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { status: "FAILED" } });
            return false;
        }

        logger.info("Cron", `Sending to ${msg.jid}`);

        if (msg.mediaUrl) {
            const type = msg.mediaType || "document";
            const to = await provider.resolveRecipient(msg.jid);
            if (await isOptedOut(msg.session.sessionId, to)) throw new Error("Descadastrado (respondeu SAIR)");
            if ((await onlyInteractedEnabled(msg.session.sessionId)) && !(await hasInteracted(msg.session.sessionId, to))) throw new Error(NO_INTERACTION_ERROR);
            const media = await resolveMedia(msg.mediaUrl); // Buffer ou { url }
            const caption = msg.content ? await personalizeFor(msg.session.sessionId, to, msg.content, [msg.jid]) : undefined;

            sendAttempted = true;
            if (type === "image" || type === "video" || type === "audio") {
                await provider.sendMedia(to, { kind: type, data: media, caption });
            } else {
                await provider.sendMedia(to, {
                    kind: "document",
                    data: media,
                    caption,
                    mimetype: "application/octet-stream",
                    fileName: msg.mediaUrl.split('/').pop() || "file",
                });
            }
        } else {
            const to = await provider.resolveRecipient(msg.jid);
            if (await isOptedOut(msg.session.sessionId, to)) throw new Error("Descadastrado (respondeu SAIR)");
            if ((await onlyInteractedEnabled(msg.session.sessionId)) && !(await hasInteracted(msg.session.sessionId, to))) throw new Error(NO_INTERACTION_ERROR);
            sendAttempted = true;
            await provider.sendText(to, msg.content ? await personalizeFor(msg.session.sessionId, to, msg.content, [msg.jid]) : "");
        }
    } catch (error) {
        const cls = classifySendFailure(error, { sendAttempted });
        logger.error("Cron", `Falha (${cls}) no envio de ${msg.id}`, error);
        await finish(cls === "unknown" ? "unknown" : "failed", { failureClass: cls, error: shortError(error) });
        if (!recurring) {
            // retentativa só para falha transitória (nada saiu) e com espera crescente; o resto encerra visível
            const falhas = cls === "transient" ? await prisma.scheduledMessageAttempt.count({ where: { scheduledMessageId: msg.id, status: "failed" } }) : MAX_ATTEMPTS;
            if (cls === "transient" && falhas < MAX_ATTEMPTS) {
                await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { sendAt: new Date(Date.now() + backoffMs(falhas)) } });
            } else {
                await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { status: "FAILED" } });
                if (cls === "unknown") await notifyOwner(msg.session.userId, "Mensagem agendada com resultado desconhecido", "Uma mensagem agendada pode ou não ter sido enviada (a conexão caiu no envio). Ela NÃO será reenviada: confira na conversa.");
            }
        }
        return false;
    }

    // A mensagem já saiu: qualquer falha daqui para baixo NÃO pode virar reenvio.
    // Se gravar o desfecho falhar, a reserva "claimed" vence e é reconciliada como "unknown": nunca reenvia.
    await finish("sent").catch((e) => logger.error("Cron", `Envio de ${msg.id} feito, mas o desfecho não foi gravado`, e));
    try {
        await recordMessages(msg.session.userId, 1);
    } catch (e) {
        logger.error("Cron", `Consumo não registrado para ${msg.id}`, e);
    }
    if (!recurring) await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { status: "SENT" } }).catch((e) => logger.error("Cron", `Envio de ${msg.id} feito, mas o status SENT não foi gravado`, e));
    return true;
}

export function initScheduler() {
    // Disparos em andamento quando o servidor reiniciou não continuam: marca como interrompidos. Com outra instância viva
    // (deploy sobreposto) só mexe nos antigos (12 h), para não marcar como parado o que a outra está enviando.
    outrasInstanciasVivas().then((outras) => {
        registrarInstancia();
        const antigos = outras === 0 ? {} : { startedAt: { lt: new Date(Date.now() - 12 * 3_600_000) } };
        return prisma.broadcastLog.updateMany({ where: { status: "running", ...antigos }, data: { status: "stopped", completedAt: new Date() } });
    }).catch(() => {});

    // Run every minute
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const now = new Date();
            await reconcileStaleClaims(now);

            // Fetch pending messages due for sending
            const pendingMessages = await loadDue(now);

            if (pendingMessages.length === 0) return;

            // Only log if we're actually processing things to reduce noise
            logger.info("Cron", `Found ${pendingMessages.length} messages to send`);

            let batchCount = 0;
            for (const msg of pendingMessages) {
                const provider = getProvider(msg.session.sessionId);

                if (!provider || !provider.isConnected()) {
                    // continua PENDING: ao reconectar, ocorrências atrasadas além de MAX_ATRASO_MS ficam registradas como "missed"
                    logger.warn("Cron", `Session ${msg.session.sessionId} not connected. Skipping.`);
                    continue;
                }

                // Modo Seguro (só com o Anti-Spam ligado): fora do horário configurado, espera
                const safe = await getSafeMode(msg.session.sessionId);
                if (safe) {
                    const gate = safeGate(safe);
                    if (!gate.ok) continue; // continua PENDING e sai quando a janela abrir
                }

                try {
                    if (!(await processDue(msg, now, provider))) continue;
                    if (safe) {
                        batchCount++;
                        if (safe.batchSize > 0 && batchCount % safe.batchSize === 0) await sleep(batchPauseMs(safe));
                        else await sleep(humanDelayMs(safe));
                    } else {
                        await sleep(2500 + Math.floor(Math.random() * 3500));
                    }
                } catch (error) {
                    // Erro de banco no meio: a reserva "claimed" vence e o ciclo seguinte a reconcilia (nunca reenvia às cegas).
                    logger.error("Cron", `Falha ao processar ${msg.id}`, error);
                }
            }

        } catch (error) {
            logger.error("Cron", "Scheduler error:", error);
        } finally {
            running = false;
        }
    };
    // Com mais de uma instância (deploy sobreposto, escala), só uma executa a rodada.
    cron.schedule("* * * * *", () => withJobLock("cron:mensagens-agendadas", 10 * 60_000, tick));

    startRetention();
    startFollowUps();
    startSocialScheduler();
    startAutomacoes();
    logger.info("Cron", "Scheduler initialized");
}
