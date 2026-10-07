import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import type { AnyMessageContent } from "@whiskeysockets/baileys";
import { z } from "zod";
import { assertCanSend, recordMessages, ownerIdOfSession, PlanError } from "@/lib/plans";
import { personalizeFor } from "@/lib/personalize";
import { resolveSendJid } from "@/lib/wa-jid";
import { getSafeMode, safeGate, gateMessage, humanDelayMs, batchPauseMs, sleepMs } from "@/lib/safe-mode";
import { isOptedOut, withFooter } from "@/lib/optout";
import { resolveMedia } from "@/lib/media";
import { onlyInteractedEnabled, hasInteracted, NO_INTERACTION_ERROR } from "@/lib/interaction";

const broadcastBodySchema = z.object({
    recipients: z.array(z.string()),
    message: z.string(),
    delay: z.number().optional(),
    /** Imagem enviada pelo painel (/api/uploads/:id): vai com o texto como legenda. */
    mediaUrl: z.string().optional(),
    /** Acrescenta "responda SAIR" ao fim de cada texto. */
    optOutFooter: z.boolean().optional(),
    /** Versões extras do texto: cada destinatário recebe uma delas, em rodízio. */
    variants: z.array(z.string()).max(5).optional()
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

        const { recipients, message, delay, mediaUrl, optOutFooter } = parseResult.data;
        const copies = [message, ...(parseResult.data.variants || []).map(v => v.trim()).filter(Boolean)]
            .map(c => (optOutFooter ? withFooter(c) : c));
        const copyFor = (i: number) => copies[i % copies.length];

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
        const onlyInteracted = await onlyInteractedEnabled(sessionId);

        (async () => {
            let sent = 0;
            let failed = 0;
            const errors: { jid: string; error: string }[] = [];
            let sinceBreak = 0;
            let deferredFrom = -1;
            let deferredNote = "";
            const stopReason = "";
            let lastWasInvalid = false;
            let mediaBuffer: Buffer | null = null;
            if (mediaUrl) {
                try {
                    const m = await resolveMedia(mediaUrl);
                    mediaBuffer = Buffer.isBuffer(m) ? m : Buffer.from(await (await fetch(m.url)).arrayBuffer());
                } catch (e: any) {
                    console.error("Broadcast media error", e);
                }
            }

            for (let i = 0; i < recipients.length; i++) {
                const jid = recipients[i];
                lastWasInvalid = false;

                if (safe) {
                    const gate = safeGate(safe);
                    if (!gate.ok) {
                        deferredFrom = i;
                        deferredNote = gateMessage(safe, gate);
                        break;
                    }
                }

                try {
                    // Resolve o JID real (corrige o 9º dígito dos números brasileiros)
                    const targetJid = await resolveSendJid(instance.socket, jid);
                    if (await isOptedOut(sessionId, targetJid)) throw new Error("Descadastrado (respondeu SAIR)");
                    if (onlyInteracted && !(await hasInteracted(sessionId, targetJid))) throw new Error(NO_INTERACTION_ERROR);
                    const personalized = await personalizeFor(sessionId, targetJid, copyFor(i), [jid]);
                    if (mediaBuffer) {
                        await instance.socket!.sendMessage(targetJid, { image: mediaBuffer, caption: personalized || undefined });
                    } else {
                        await instance.socket!.sendMessage(targetJid, { text: personalized });
                    }
                    sent++;
                    if (ownerId) await recordMessages(ownerId, 1);
                    if (safe) sinceBreak++;

                    // Update recipient status in DB
                    await prisma.broadcastRecipient.updateMany({
                        where: { broadcastLogId: broadcastId, jid },
                        data: { status: "sent", sentAt: new Date() }
                    });
                } catch (e: any) {
                    failed++;
                    // número inválido ou descadastrado: nada foi enviado, não precisa esperar
                    lastWasInvalid = /não possui WhatsApp|Descadastrado|Sem conversa anterior/i.test(e?.message || "");
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

                // Delay between sends
                if (i < recipients.length - 1) {
                    if (safe) {
                        if (lastWasInvalid) await sleepMs(400 + Math.floor(Math.random() * 800)); // nada foi enviado
                        else if (safe.batchSize > 0 && sinceBreak >= safe.batchSize) { sinceBreak = 0; await sleepMs(batchPauseMs(safe)); }
                        else await sleepMs(humanDelayMs(safe, delay || 0));
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
                        data: rest.map((jid, k) => ({ sessionId: dbSession.id, jid, content: copyFor(deferredFrom + k), mediaUrl: mediaUrl || null, mediaType: mediaUrl ? "image" : null, sendAt: new Date(), status: "PENDING" }))
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
