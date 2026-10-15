import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import moment from "moment-timezone";
import cronParser from "cron-parser";
import { lerCorpo, opt } from "@/lib/validate";
import { z } from "zod";

const schema = z.object({
    jid: z.string().min(1, "informe o destinatário (jid)"),
    content: opt(z.string()),
    sendAt: z.union([z.string().min(1), z.number()], { error: "informe a data e hora do envio (sendAt)" }),
    mediaUrl: opt(z.string()),
    mediaType: opt(z.string()),
    cronExpression: opt(z.string().refine((c) => { try { cronParser.parse(c); return true; } catch { return false; } }, "expressão cron inválida")),
    recurrenceRule: opt(z.string()),
}).refine((b) => !!b.content || !!b.mediaUrl, { path: ["content"], message: "informe o texto ou uma mídia" });

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; scheduleId: string }> }
) {
    try {
        const { sessionId, scheduleId } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const lido = await lerCorpo(request, schema);
        if (!lido.ok) return lido.response;
        const { jid, content, sendAt, mediaUrl, mediaType, cronExpression, recurrenceRule } = lido.data;

        // Fetch system timezone
        // @ts-ignore
        const systemConfig = await prisma.systemConfig.findUnique({ where: { id: "default" } });
        const timezone = systemConfig?.timezone || "America/Sao_Paulo";

        console.log(`[Scheduler:PUT] Received sendAt: ${sendAt}, using timezone: ${timezone}`);
        const utcDate = moment.tz(sendAt, timezone).toDate();
        console.log(`[Scheduler:PUT] Resolved UTC Date: ${utcDate.toISOString()}`);

        const msg = await prisma.scheduledMessage.findUnique({
            where: { id: scheduleId },
            include: { session: true }
        });

        if (!msg) {
            return NextResponse.json({ status: false, message: "Message not found", error: "Message not found" }, { status: 404 });
        }

        // Verify the schedule belongs to this session
        if (msg.session.sessionId !== sessionId) {
            return NextResponse.json({ status: false, message: "Schedule not found in this session", error: "Schedule not found in this session" }, { status: 404 });
        }

        const updated = await prisma.scheduledMessage.update({
            where: { id: scheduleId },
            data: {
                jid,
                content,
                sendAt: utcDate,
                mediaUrl: mediaUrl || null,
                mediaType: mediaType || null,
                cronExpression: cronExpression !== undefined ? cronExpression : msg.cronExpression,
                recurrenceRule: recurrenceRule !== undefined ? recurrenceRule : msg.recurrenceRule
            }
        });

        return NextResponse.json(updated);
    } catch (error) {
        console.error("Update schedule error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; scheduleId: string }> }
) {
    try {
        const { sessionId, scheduleId } = await params;

        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const msg = await prisma.scheduledMessage.findUnique({
            where: { id: scheduleId },
            include: { session: true }
        });

        if (!msg) {
            return NextResponse.json({ status: false, message: "Message not found", error: "Message not found" }, { status: 404 });
        }

        // Verify the schedule belongs to this session
        if (msg.session.sessionId !== sessionId) {
            return NextResponse.json({ status: false, message: "Schedule not found in this session", error: "Schedule not found in this session" }, { status: 404 });
        }

        await prisma.scheduledMessage.delete({ where: { id: scheduleId } });
        return NextResponse.json({ status: true, message: "Operation successful" });

    } catch (error) {
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}
