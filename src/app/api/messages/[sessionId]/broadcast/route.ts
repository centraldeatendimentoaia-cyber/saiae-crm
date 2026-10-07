import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import type { AnyMessageContent } from "@whiskeysockets/baileys";
import { z } from "zod";
import { assertCanSend, recordMessages, ownerIdOfSession, PlanError } from "@/lib/plans";
import { personalizeFor } from "@/lib/personalize";
import { resolveSendJid } from "@/lib/wa-jid";
import {
    getSafeMode, safeGate, addSentToday, gateMessage, humanDelayMs, batchPauseMs, sleepMs,
    BATCH_SIZE, MAX_INVALID_RATE, MIN_CHECKED, MAX_CONSECUTIVE_ERRORS,
} from "@/lib/safe-mode";

const broadcastBodySchema = z.object({
    recipients: z.array(z.string()),
    message: z.string().min(1),
    delay: z.number().optional()
});

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const body = await request.json();

        const parseResult = broadcastBodySchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json({ error: parseResult.error.flatten() }, { status: 400 });
        }

        const { recipients, message, delay } = parseResult.data;

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden", error: "Forbidden" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // --- Plano: bloqueia se a conta estiver suspensa ou sem cota ---
        const ownerId = await ownerIdOfSession(sessionId);
        if (ownerId) await assertCanSend(ownerId, recipients.length);

        // --- Save BroadcastLog & recipients to DB ---
        const log = await prisma.broadcastLog.create({
            data: {
                sessionId,
                message,
                total: recipients.length,
                delay: delay || 2000,
                status: "running",
                recipients: {
                    create: recipients.map(jid => ({
                        jid,
                        status: "pending"
                    }))
                }
            },
            include: { recipients: true }
        });

        const messageContent: AnyMessageContent = { text: message };
        const io = (global as any).io;
        const broadcastId = log.id;

        // Emit initial state
        if (io) {
            io.to(sessionId).emit("broadcast.progress", {
                broadcastId,
                status: "running",
                total: recipients.length,
                sent: 0,
                failed: 0,
                current: null,
                progress: 0,
                startedAt: log.startedAt.toISOString()
            });
        }

        // Process in background — update DB as we go
        // Modo Seguro: só quando o Anti-Spam do número está ligado
        const safe = await getSafeMode(sessionId);

        (async () => {
            let sent = 0;
            let failed = 0;
            const errors: { jid: string; error: string }[] = [];
            let checked = 0;
            let invalid = 0;
            let consecutiveErrors = 0;
            let sinceBreak = 0;
            let deferredFrom = -1;
            let deferredNote = "";
            let stopReason = "";
            let lastWasInvalid = false;

            for (let i = 0; i < recipients.length; i++) {
                const jid = recipients[i];
                lastWasInvalid = false;

                if (safe) {
                    const gate = await safeGate(sessionId, safe);
                    if (!gate.ok) {
                        deferredFrom = i;
                        deferredNote = gateMessage(gate);
                        break;
                    }
                }

                try {
                    // Resolve o JID real (corrige o 9º dígito dos números brasileiros)
                    const targetJid = await resolveSendJid(instance.socket, jid);
                    const personalized = await personalizeFor(sessionId, targetJid, message, [jid]);
                    await instance.socket!.sendMessage(targetJid, { text: personalized });
                    sent++;
                    consecutiveErrors = 0;
                    if (ownerId) await recordMessages(ownerId, 1);
                    if (safe) { await addSentToday(sessionId, 1); sinceBreak++; }

                    // Update recipient status in DB
                    await prisma.broadcastRecipient.updateMany({
                        where: { broadcastLogId: broadcastId, jid },
                        data: { status: "sent", sentAt: new Date() }
                    });
                } catch (e: any) {
                    failed++;
                    lastWasInvalid = /não possui WhatsApp/i.test(e?.message || "");
                    if (lastWasInvalid) invalid++; else consecutiveErrors++;
                    errors.push({ jid, error: e.message || "Unknown error" });
                    console.error(`Failed to send broadcast to ${jid}`, e);

                    // Update recipient error in DB
                    await prisma.broadcastRecipient.updateMany({
                        where: { broadcastLogId: broadcastId, jid },
                        data: { status: "failed", error: e.message || "Unknown error" }
                    });
                }

                const progress = Math.round(((sent + failed) / recipients.length) * 100);

                // Update BroadcastLog progress in DB
                await prisma.broadcastLog.update({
                    where: { id: broadcastId },
                    data: { sent, failed }
                });

                // Socket real-time
                if (io) {
                    io.to(sessionId).emit("broadcast.progress", {
                        broadcastId,
                        status: "running",
                        total: recipients.length,
                        sent,
                        failed,
                        current: jid,
                        progress
                    });
                }

                checked++;

                // Freio automático: lista ruim ou erros seguidos -> para antes de o número ser bloqueado
                if (safe) {
                    if (checked >= MIN_CHECKED && invalid / checked > MAX_INVALID_RATE) {
                        stopReason = `Disparo pausado: ${Math.round((invalid / checked) * 100)}% dos números não têm WhatsApp. Limpe a lista e comece de novo.`;
                        break;
                    }
                    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                        stopReason = "Disparo pausado: vários erros seguidos de envio. Confira a conexão e o estado do número antes de continuar.";
                        break;
                    }
                }

                // Delay between sends
                if (i < recipients.length - 1) {
                    if (safe) {
                        if (lastWasInvalid) await sleepMs(400 + Math.floor(Math.random() * 800)); // nada foi enviado
                        else if (sinceBreak >= BATCH_SIZE) { sinceBreak = 0; await sleepMs(batchPauseMs()); }
                        else await sleepMs(humanDelayMs(delay || 0));
                    } else {
                        const baseDelay = delay || 2000;
                        const randomDelay = baseDelay + Math.floor(Math.random() * (baseDelay * 0.5));
                        await new Promise(r => setTimeout(r, randomDelay));
                    }
                }
            }

            // O que não coube hoje vira mensagem agendada: o agendador envia dentro do horário e do limite
            let deferred = 0;
            if (deferredFrom >= 0) {
                const rest = recipients.slice(deferredFrom);
                const dbSession = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
                if (dbSession) {
                    await prisma.scheduledMessage.createMany({
                        data: rest.map(jid => ({ sessionId: dbSession.id, jid, content: message, sendAt: new Date(), status: "PENDING" }))
                    });
                    await prisma.broadcastRecipient.updateMany({
                        where: { broadcastLogId: broadcastId, jid: { in: rest }, status: "pending" },
                        data: { status: "scheduled" }
                    });
                    deferred = rest.length;
                }
            }

            const finalStatus = stopReason ? "stopped" : "completed";

            // Mark as finished in DB
            await prisma.broadcastLog.update({
                where: { id: broadcastId },
                data: { status: finalStatus, sent, failed, completedAt: new Date() }
            });

            // Final socket emit
            if (io) {
                io.to(sessionId).emit("broadcast.progress", {
                    broadcastId,
                    status: finalStatus,
                    total: recipients.length,
                    sent,
                    failed,
                    errors,
                    deferred,
                    note: stopReason || deferredNote || undefined,
                    progress: stopReason ? Math.round(((sent + failed) / recipients.length) * 100) : 100,
                    completedAt: new Date().toISOString()
                });
            }
            console.log(`Broadcast ${broadcastId} completed: ${sent} sent, ${failed} failed out of ${recipients.length}`);
        })();

        return NextResponse.json({
            status: true,
            message: "Broadcast started",
            data: { broadcastId: log.id, total: recipients.length }
        });

    } catch (e) {
        if ((e as any)?.name === "PlanError") {
            return NextResponse.json({ status: false, message: (e as PlanError).message, error: (e as PlanError).message, code: "PLAN_LIMIT" }, { status: 402 });
        }
        console.error("Broadcast error", e);
        return NextResponse.json({ status: false, message: "Failed to start broadcast", error: "Failed to start broadcast" }, { status: 500 });
    }
}
