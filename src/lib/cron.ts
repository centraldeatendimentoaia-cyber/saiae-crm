import cron from "node-cron";
import { personalizeFor } from "@/lib/personalize";
import cronParser from "cron-parser";
import { prisma } from "@/lib/prisma";
import { getProvider } from "@/modules/whatsapp/provider";
import { logger } from "./logger";
import { assertCanSend, recordMessages } from "@/lib/plans";
import { isOptedOut } from "@/lib/optout";
import { onlyInteractedEnabled, hasInteracted, NO_INTERACTION_ERROR } from "@/lib/interaction";
import { startRetention } from "@/lib/retention";
import { startFollowUps } from "@/modules/agente-salao/followup";
import { resolveMedia } from "@/lib/media";
import { getSafeMode, safeGate, humanDelayMs, batchPauseMs } from "@/lib/safe-mode";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let running = false; // evita duas rodadas ao mesmo tempo
export function initScheduler() {
    // disparos que estavam em andamento quando o servidor reiniciou não continuam: marca como interrompidos
    prisma.broadcastLog.updateMany({ where: { status: "running" }, data: { status: "stopped", completedAt: new Date() } }).catch(() => {});

    // Run every minute
    cron.schedule("* * * * *", async () => {
        if (running) return;
        running = true;
        try {
            const now = new Date();
            
            // Fetch pending messages due for sending
            const pendingMessages = await prisma.scheduledMessage.findMany({
                where: {
                    status: "PENDING",
                    sendAt: {
                        lte: now
                    }
                },
                include: {
                    session: true
                }
            });

            if (pendingMessages.length === 0) return;

            // Only log if we're actually processing things to reduce noise
            logger.info("Cron", `Found ${pendingMessages.length} messages to send`);

            let batchCount = 0;
            for (const msg of pendingMessages) {
                const provider = getProvider(msg.session.sessionId);

                if (!provider || !provider.isConnected()) {
                    logger.warn("Cron", `Session ${msg.session.sessionId} not connected. Skipping.`);
                    // Optionally mark as FAILED or retry later
                    // keeping PENDING will define behavior (retry next minute)
                    // But if session is dead for long time, it piles up.
                    // Let's keep it PENDING for now.
                    continue;
                }

                // Modo Seguro (só com o Anti-Spam ligado): fora do horário configurado, espera
                const safe = await getSafeMode(msg.session.sessionId);
                if (safe) {
                    const gate = safeGate(safe);
                    if (!gate.ok) continue; // continua PENDING e sai quando a janela abrir
                }

                try {
                    // Plano: conta suspensa ou sem cota não envia
                    try {
                        await assertCanSend(msg.session.userId, 1);
                    } catch (planErr: any) {
                        logger.warn("Cron", `Plano bloqueou o envio ${msg.id}: ${planErr.message}`);
                        if (!msg.cronExpression) {
                            await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { status: "FAILED" } });
                        } else {
                            const itv = cronParser.parse(msg.cronExpression, { tz: "America/Sao_Paulo" });
                            await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { sendAt: itv.next().toDate() } });
                        }
                        continue;
                    }

                    logger.info("Cron", `Sending to ${msg.jid}`);
                    
                    if (msg.mediaUrl) {
                        const type = msg.mediaType || "document";
                        const to = await provider.resolveRecipient(msg.jid);
                        if (await isOptedOut(msg.session.sessionId, to)) throw new Error("Descadastrado (respondeu SAIR)");
                        if ((await onlyInteractedEnabled(msg.session.sessionId)) && !(await hasInteracted(msg.session.sessionId, to))) throw new Error(NO_INTERACTION_ERROR);
                        const media = await resolveMedia(msg.mediaUrl); // Buffer ou { url }
                        const caption = msg.content ? await personalizeFor(msg.session.sessionId, to, msg.content, [msg.jid]) : undefined;

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
                        await provider.sendText(to, msg.content ? await personalizeFor(msg.session.sessionId, to, msg.content, [msg.jid]) : "");
                    }

                    await recordMessages(msg.session.userId, 1);

                    // Update status or compute next sendAt if recurring
                    if (msg.cronExpression) {
                        const interval = cronParser.parse(msg.cronExpression, { tz: "America/Sao_Paulo" });
                        const nextDate = interval.next().toDate();
                        await prisma.scheduledMessage.update({
                            where: { id: msg.id },
                            data: { sendAt: nextDate } // Keep status as PENDING
                        });
                    } else {
                        await prisma.scheduledMessage.update({
                            where: { id: msg.id },
                            data: { status: "SENT" }
                        });
                    }

                    if (safe) {
                        batchCount++;
                        if (safe.batchSize > 0 && batchCount % safe.batchSize === 0) await sleep(batchPauseMs(safe));
                        else await sleep(humanDelayMs(safe));
                    } else {
                        await sleep(2500 + Math.floor(Math.random() * 3500));
                    }
                } catch (error) {
                    logger.error("Cron", `Check failed for ${msg.id}`, error);
                    if (!msg.cronExpression) {
                        await prisma.scheduledMessage.update({
                            where: { id: msg.id },
                            data: { status: "FAILED" } // Failed to send
                        });
                    } else {
                        const interval = cronParser.parse(msg.cronExpression, { tz: "America/Sao_Paulo" });
                        await prisma.scheduledMessage.update({
                            where: { id: msg.id },
                            data: { sendAt: interval.next().toDate() }
                        });
                    }
                }
            }

        } catch (error) {
            logger.error("Cron", "Scheduler error:", error);
        } finally {
            running = false;
        }
    });
    
    startRetention();
    startFollowUps();
    logger.info("Cron", "Scheduler initialized");
}
