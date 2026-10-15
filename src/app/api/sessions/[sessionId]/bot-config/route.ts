import { prisma } from "@/lib/prisma";
import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { lerCorpo } from "@/lib/validate";
import { z } from "zod";

const jids = z.array(z.string()).nullish();
const bool = z.boolean().nullish();
const schema = z.object({
    enabled: bool,
    botMode: z.enum(["ALL", "OWNER", "SPECIFIC", "BLACKLIST"], { error: "use ALL, OWNER, SPECIFIC ou BLACKLIST" }).nullish(),
    botAllowedJids: jids,
    botBlockedJids: jids,
    autoReplyMode: z.enum(["ALL", "OWNER", "SPECIFIC", "BLACKLIST"], { error: "use ALL, OWNER, SPECIFIC ou BLACKLIST" }).nullish(),
    autoReplyAllowedJids: jids,
    autoReplyBlockedJids: jids,
    botName: z.string().max(100).nullish(),
    enableSticker: bool,
    enableVideoSticker: bool,
    maxStickerDuration: z.coerce.number().min(0).max(600).nullish(),
    enablePing: bool,
    enableUptime: bool,
    removeBgApiKey: z.string().nullish(),
    prefix: z.string().max(10, "o prefixo pode ter no máximo 10 caracteres").nullish(),
    antiSpamEnabled: bool,
    spamLimit: z.coerce.number().min(0).max(10000).nullish(),
    spamInterval: z.coerce.number().min(0).max(100000).nullish(),
    spamDelayMin: z.coerce.number().min(0).max(3600000).nullish(),
    spamDelayMax: z.coerce.number().min(0).max(3600000).nullish(),
    safeDelayMin: z.coerce.number().min(0).max(3600).nullish(),
    safeDelayMax: z.coerce.number().min(0).max(3600).nullish(),
    safeBatchSize: z.coerce.number().min(0).max(10000).nullish(),
    safeBatchPause: z.coerce.number().min(0).max(1440).nullish(),
    safeStartHour: z.coerce.number().min(0).max(24).nullish(),
    safeEndHour: z.coerce.number().min(0).max(24).nullish(),
    onlyInteracted: bool,
    welcomeMessage: z.string().nullish(),
    autoRead: bool,
    alwaysOnline: bool,
});

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const { sessionId } = await params;

    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        // @ts-ignore
        const session = await (prisma as any).session.findUnique({
            where: { sessionId },
            select: { id: true, botConfig: true }
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        // Return config or default if null
        session.botConfig = session.botConfig || {
            enabled: true,
            botMode: 'OWNER',
            botAllowedJids: [],
            botBlockedJids: [],
            autoReplyMode: 'ALL',
            autoReplyAllowedJids: [],
            autoReplyBlockedJids: [],
            enableSticker: true,
            enablePing: true,
            enableUptime: true,
            botName: "Saiaê Bot",
            removeBgApiKey: null,
            enableVideoSticker: true,
            maxStickerDuration: 10,
            prefix: "#",
            antiSpamEnabled: true,
            spamLimit: 5,
            spamInterval: 10,
            spamDelayMin: 1000,
            spamDelayMax: 3000,
            safeDelayMin: 10,
            safeDelayMax: 40,
            safeBatchSize: 25,
            safeBatchPause: 3,
            safeStartHour: 9,
            safeEndHour: 19,
            onlyInteracted: false,
            welcomeMessage: null,
            autoRead: false,
            alwaysOnline: false
        };

        return NextResponse.json({ status: true, message: "Bot config fetched successfully", data: session.botConfig });
    } catch (error) {
        console.error("Get Bot Config Error:", error);
        return NextResponse.json({ status: false, message: "Internal Server Error", error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const { sessionId } = await params;

    try {
        const user = await getAuthenticatedUser(request);
        if (!user) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });

        const lido = await lerCorpo(request, schema);
        if (!lido.ok) return lido.response;
        const body = lido.data;

        // Find session DB ID
        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        if (!session) return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });

        // Upsert Config
        // @ts-ignore
        const config = await (prisma as any).botConfig.upsert({
            where: { sessionId: session.id },
            create: {
                sessionId: session.id,
                enabled: body.enabled ?? true,
                botMode: body.botMode || 'OWNER',
                botAllowedJids: body.botAllowedJids || [],
                botBlockedJids: body.botBlockedJids || [],
                autoReplyMode: body.autoReplyMode || 'ALL',
                autoReplyAllowedJids: body.autoReplyAllowedJids || [],
                autoReplyBlockedJids: body.autoReplyBlockedJids || [],

                enableSticker: body.enableSticker ?? true,
                enableVideoSticker: body.enableVideoSticker ?? true,
                maxStickerDuration: body.maxStickerDuration || 10,
                enablePing: body.enablePing ?? true,
                enableUptime: body.enableUptime ?? true,
                removeBgApiKey: body.removeBgApiKey || null,
                prefix: body.prefix || "#",
                antiSpamEnabled: body.antiSpamEnabled ?? true,
                spamLimit: body.spamLimit || 5,
                spamInterval: body.spamInterval || 10,
                spamDelayMin: body.spamDelayMin || 1000,
                spamDelayMax: body.spamDelayMax || 3000,
                safeDelayMin: body.safeDelayMin ?? 10,
                safeDelayMax: body.safeDelayMax ?? 40,
                safeBatchSize: body.safeBatchSize ?? 25,
                safeBatchPause: body.safeBatchPause ?? 3,
                safeStartHour: body.safeStartHour ?? 9,
                safeEndHour: body.safeEndHour ?? 19,
                onlyInteracted: body.onlyInteracted ?? false,
                welcomeMessage: body.welcomeMessage || null,
                autoRead: body.autoRead ?? false,
                alwaysOnline: body.alwaysOnline ?? false,
            },
            update: {
                botMode: body.botMode,
                botAllowedJids: body.botAllowedJids,
                botBlockedJids: body.botBlockedJids,
                autoReplyMode: body.autoReplyMode,
                autoReplyAllowedJids: body.autoReplyAllowedJids,
                autoReplyBlockedJids: body.autoReplyBlockedJids,
                botName: body.botName,
                enableSticker: body.enableSticker,
                enableVideoSticker: body.enableVideoSticker,
                maxStickerDuration: body.maxStickerDuration,
                enablePing: body.enablePing,
                enableUptime: body.enableUptime,
                removeBgApiKey: body.removeBgApiKey || null,
                prefix: body.prefix,
                antiSpamEnabled: body.antiSpamEnabled,
                spamLimit: body.spamLimit,
                spamInterval: body.spamInterval,
                spamDelayMin: body.spamDelayMin,
                spamDelayMax: body.spamDelayMax,
                safeDelayMin: body.safeDelayMin,
                safeDelayMax: body.safeDelayMax,
                safeBatchSize: body.safeBatchSize,
                safeBatchPause: body.safeBatchPause,
                safeStartHour: body.safeStartHour,
                safeEndHour: body.safeEndHour,
                onlyInteracted: body.onlyInteracted,
                welcomeMessage: body.welcomeMessage,
                autoRead: body.autoRead,
                alwaysOnline: body.alwaysOnline,
            }
        });

        return NextResponse.json({ status: true, message: "Bot config updated successfully", data: config });
    } catch (error) {
        console.error("Update Bot Config Error:", error);
        return NextResponse.json({ status: false, message: "Failed to update config", error: "Failed to update config" }, { status: 500 });
    }
}
