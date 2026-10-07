import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import moment from "moment-timezone";
import { withFooter } from "@/lib/optout";
import { canonicalPhone } from "@/lib/phone";

// GET: List Scheduled Messages
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;

        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const url = new URL(request.url);
        const tab = url.searchParams.get("tab") || "pending";
        
        const whereClause: any = { sessionId: session.id };
        let orderByClause: any = { sendAt: 'asc' };
        
        if (tab === "history") {
            whereClause.status = { in: ["SENT", "FAILED"] };
            orderByClause = { sendAt: 'desc' };
        } else {
            whereClause.status = "PENDING";
        }

        const messages = await prisma.scheduledMessage.findMany({
            where: whereClause,
            include: { session: true },
            orderBy: orderByClause
        });

        return NextResponse.json({ status: true, message: "Scheduled messages retrieved successfully", data: messages });

    } catch (error) {
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}

// POST: Create Scheduled Message
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;

        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const { jid, jids, spacingMs, content, sendAt, mediaUrl, mediaType, cronExpression, recurrenceRule, optOutFooter } = body;
        // Versões extras do texto: cada destinatário recebe uma delas, em rodízio
        const variants: string[] = Array.isArray(body.variants) ? body.variants.filter((v: unknown) => typeof v === "string" && v.trim()).slice(0, 5) : [];
        const copies: string[] = ([content || "", ...variants] as string[]).map(c => (optOutFooter ? withFooter(c) : c));
        const rawTargets: string[] = Array.isArray(jids) ? jids.filter((j: unknown) => typeof j === "string" && j) : (jid ? [jid] : []);
        // a mesma pessoa (com/sem o 9º dígito) só entra uma vez
        const seenKeys = new Set<string>();
        const targets = rawTargets.filter(t => {
            const key = t.includes("@s.whatsapp.net") ? canonicalPhone(t) : t;
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
        });

        if (targets.length === 0 || targets.length > 500 || (!content && !mediaUrl) || !sendAt) {
            return NextResponse.json({ status: false, message: "Missing required fields (recipients up to 500, Content/Media, SendAt)", error: "Missing required fields" }, { status: 400 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        // Fetch system timezone
        // @ts-ignore
        const systemConfig = await prisma.systemConfig.findUnique({ where: { id: "default" } });
        const timezone = systemConfig?.timezone || "America/Sao_Paulo";

        console.log(`[Scheduler:POST] Received sendAt: ${sendAt}, using timezone: ${timezone}`);
        const utcDate = moment.tz(sendAt, timezone).toDate();
        console.log(`[Scheduler:POST] Resolved UTC Date: ${utcDate.toISOString()}`);

        // Vários destinatários: cada um sai alguns segundos depois do anterior (evita rajada e bloqueio)
        const spacing = Math.max(3000, Number(spacingMs) || 5000);
        const created = [];
        for (let i = 0; i < targets.length; i++) {
            const offset = targets.length > 1 ? i * spacing + Math.floor(Math.random() * 2000) : 0;
            created.push(await prisma.scheduledMessage.create({
                data: {
                    sessionId: session.id,
                    jid: targets[i],
                    content: copies[i % copies.length] || null,
                    mediaUrl,
                    mediaType,
                    cronExpression,
                    recurrenceRule,
                    sendAt: new Date(utcDate.getTime() + offset),
                    status: "PENDING"
                }
            }));
        }
        const scheduled = created.length === 1 ? created[0] : { count: created.length };

        return NextResponse.json({ status: true, message: "Message scheduled successfully", data: scheduled });

    } catch (error) {
        console.error("Schedule error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }

}

