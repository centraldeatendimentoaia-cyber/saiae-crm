import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getAuthenticatedUser, canAccessSession, isAdmin } from "@/lib/api-auth";
import { lerCorpo, opt } from "@/lib/validate";
import { z } from "zod";
import { MATCH_TYPES } from "@/modules/whatsapp/store/autoreply-match";

const schema = z.object({
    keyword: z.string().min(1, "informe a palavra-chave"),
    response: opt(z.string()),
    matchType: opt(z.enum(MATCH_TYPES, { error: "use EXACT, CONTAINS, STARTS_WITH ou REGEX" })),
    triggerType: opt(z.enum(["ALL", "GROUP", "PRIVATE"], { error: "use ALL, GROUP ou PRIVATE" })),
    isMedia: opt(z.boolean()),
    mediaUrl: opt(z.string()),
    mediaType: opt(z.string()),
}).refine((b) => !!b.response || !!b.mediaUrl, { path: ["response"], message: "informe a resposta ou uma mídia" });

// GET: List Auto Replies
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

        const rules = await prisma.autoReply.findMany({
            where: { sessionId: session.id },
            include: { session: true },
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json({ status: true, message: "Auto-replies retrieved successfully", data: rules });

    } catch (error) {
        console.error("Fetch auto replies error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}

// POST: Create Auto Reply
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

        const lido = await lerCorpo(request, schema);
        if (!lido.ok) return lido.response;
        const { keyword, response, matchType, isMedia, mediaUrl, mediaType, triggerType } = lido.data;

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

        const createData: Prisma.AutoReplyUncheckedCreateInput = {
            sessionId: session.id,
            keyword,
            response,
            matchType: matchType || "EXACT",
            isMedia: isMedia || false,
            mediaUrl: mediaUrl || null,
            mediaType: mediaType || null,
            // @ts-ignore: triggerType exists in generated schema but may be stale in editor types
            triggerType: (triggerType as string) || "ALL"
        };

        const newRule = await prisma.autoReply.create({
            data: createData
        });

        return NextResponse.json({ status: true, message: "Auto-reply created successfully", data: newRule });

    } catch (error) {
        console.error("Create auto reply error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }

}

