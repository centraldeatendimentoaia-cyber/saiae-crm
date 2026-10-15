import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { lerCorpo } from "@/lib/validate";
import { z } from "zod";

const schema = z.object({ pin: z.boolean({ error: "informe pin (true ou false)" }) });

// PUT: Pin or unpin a chat
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, jid } = await params;
        const lido = await lerCorpo(request, schema);
        if (!lido.ok) return lido.response;
        const { pin } = lido.data;
        const decodedJid = decodeURIComponent(jid);

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // Pin or unpin chat
        await instance.socket.chatModify(
            { 
                pin: pin,
                lastMessages: []
            },
            decodedJid
        );

        return NextResponse.json({ 
            success: true,
            message: pin ? "Chat pinned successfully" : "Chat unpinned successfully"
        });

    } catch (error) {
        console.error("Pin chat error:", error);
        return NextResponse.json({ status: false, message: "Failed to pin/unpin chat", error: "Failed to pin/unpin chat" }, { status: 500 });
    }
}
