import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getProvider } from "@/modules/whatsapp/provider";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import type { AnyMessageContent } from "@whiskeysockets/baileys";
import { z } from "zod";
import { assertCanSend, recordMessages, ownerIdOfSession, PlanError } from "@/lib/plans";
import { personalizeFor } from "@/lib/personalize";
import { getSafeMode, safeGate, gateMessage, humanDelayMs, batchPauseMs, sleepMs } from "@/lib/safe-mode";
import { isOptedOut, withFooter } from "@/lib/optout";
import { resolveMedia } from "@/lib/media";
import { canonicalPhone, jidVariants } from "@/lib/phone";
import { onlyInteractedEnabled, hasInteracted, NO_INTERACTION_ERROR } from "@/lib/interaction";

/** Disparos em andamento neste servidor (um por número): evita lançar o mesmo disparo duas vezes. */
const running: Map<string, string> = ((globalThis as any).__broadcastRunning ||= new Map());
const DUPLICATE_WINDOW_MS = 12 * 60 * 60 * 1000;

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

        const { message, delay, mediaUrl, optOutFooter } = parseResult.data;
        // mesma pessoa escrita de jeitos diferentes (com/sem o 9º dígito) entra uma vez só
        const seenKeys = new Set<string>();
        const recipients = parseResult.data.recipients.filter(r => {
            const key = r.includes("@s.whatsapp.net") ? canonicalPhone(r) : r;
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
        });
        const copies = [message, ...(parseResult.data.variants || []).map(v => v.trim()).filter(Boolean)]
            .map(c => (optOutFooter ? withFooter(c) : c));
        const copyFor = (i: number) => copies[i % copies.length];

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden", error: "Forbidden" }, { status: 403 });
        }

        const provider = getProvider(sessionId);
        if (!provider?.isConnected()) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // trava contra disparo duplo, mas se o registro já não está "em andamento" (cancelado, interrompido) a trava se desfaz sozinha
        const activeId = running.get(sessionId);
        if (activeId) {
            const active = await prisma.broadcastLog.findUnique({ where: { id: activeId }, select: { status: true } });
            if (active?.status !== "running") running.delete(sessionId);
        }
        if (running.has(sessionId)) {
            return NextResponse.json({ status: false, message: "Já existe um disparo em andamento neste número. Espere terminar ou cancele-o antes de começar outro.", code: "BROADCAST_RUNNING" }, { status: 409 });
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
        running.set(sessionId, broadcastId); // só depois de tudo pronto: um erro antes daqui não deixa a trava presa

        (async () => {
            let sent = 0;
            let failed = 0;
            const errors: { jid: string; error: string }[] = [];
            let sinceBreak = 0;
            let deferredFrom = -1;
            let deferredNote = "";
            const stopReason = "";
            let lastWasInvalid = false;
            let cancelled = false;
            const sentTargets = new Set<string>();
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

                // o usuário pode cancelar a qualquer momento
                const cur = await prisma.broadcastLog.findUnique({ where: { id: broadcastId }, select: { status: true } });
                if (cur?.status === "cancelled") { cancelled = true; break; }

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
                    const targetJid = await provider!.resolveRecipient(jid);
                    if (sentTargets.has(targetJid)) throw new Error("Número repetido na lista (Repetido)");
                    // proteção contra envio em dobro: já recebeu esta mesma mensagem recentemente?
                    const already = await prisma.broadcastRecipient.findFirst({
                        where: {
                            status: "sent",
                            sentAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
                            jid: { in: [...jidVariants(jid), targetJid] },
                            broadcastLog: { sessionId, message },
                        },
                        select: { id: true },
                    });
                    if (already) throw new Error("Repetido: já recebeu esta mensagem nas últimas 12h");
                    if (await isOptedOut(sessionId, targetJid)) throw new Error("Descadastrado (respondeu SAIR)");
                    if (onlyInteracted && !(await hasInteracted(sessionId, targetJid))) throw new Error(NO_INTERACTION_ERROR);
                    const personalized = await personalizeFor(sessionId, targetJid, copyFor(i), [jid]);
                    if (mediaBuffer) {
                        await provider!.sendMedia(targetJid, { kind: "image", data: mediaBuffer, caption: personalized || undefined });
                    } else {
                        await provider!.sendText(targetJid, personalized);
                    }
                    sent++;
                    sentTargets.add(targetJid);
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
                    lastWasInvalid = /não possui WhatsApp|Descadastrado|Sem conversa anterior|Repetido/i.test(e?.message || "");
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
            if (deferredFrom >= 0 && !cancelled) {
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

            const finalStatus = cancelled ? "cancelled" : stopReason ? "stopped" : "completed";

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
                    note: cancelled ? "Disparo cancelado." : stopReason || deferredNote || undefined,
                    progress: stopReason || cancelled ? Math.round(((sent + failed) / recipients.length) * 100) : 100,
                    completedAt: new Date().toISOString()
                });
            }
            console.log(`Broadcast ${broadcastId} completed: ${sent} sent, ${failed} failed out of ${recipients.length}`);
        })()
            .catch(async (e) => {
                console.error("Broadcast loop error", e);
                await prisma.broadcastLog.update({ where: { id: broadcastId }, data: { status: "stopped", completedAt: new Date() } }).catch(() => {});
            })
            .finally(() => { if (running.get(sessionId) === broadcastId) running.delete(sessionId); });

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
