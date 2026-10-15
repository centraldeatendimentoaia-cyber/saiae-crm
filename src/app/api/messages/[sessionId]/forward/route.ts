import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { requireCapability } from "@/modules/whatsapp/provider/require";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { proto } from "@whiskeysockets/baileys";
import { lerCorpo } from "@/lib/validate";
import { z } from "zod";

const schema = z.object({
    fromJid: z.string().min(1, "informe o fromJid"),
    messageId: z.string().min(1, "informe o messageId"),
    toJids: z.array(z.string().min(1)).min(1, "informe ao menos um destinatário"),
});

// POST: Forward message to other chats
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
        const lido = await lerCorpo(request, schema);
        if (!lido.ok) return lido.response;
        const { fromJid, messageId, toJids } = lido.data;

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const unsupported = requireCapability(sessionId, "forwarding");
        if (unsupported) return unsupported;

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

         // Forward message to each recipient
        for (const toJid of toJids) {
            await instance.socket.sendMessage(toJid, {
                forward: {
                    key: {
                        remoteJid: fromJid,
                        fromMe: false,
                        id: messageId
                    },
                    message: {} as proto.IMessage
                }
            });
        }

        return NextResponse.json({ status: true, message: `Message forwarded to ${toJids.length} recipient(s)` });

    } catch (error) {
        console.error("Forward message error:", error);
        return NextResponse.json({ status: false, message: "Failed to forward message", error: "Failed to forward message" }, { status: 500 });
    }
}
