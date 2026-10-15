import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { requireCapability } from "@/modules/whatsapp/provider/require";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { lerCorpo } from "@/lib/validate";
import { z } from "zod";

const schema = z.object({
    action: z.enum(["add", "remove", "promote", "demote"], { error: "use add, remove, promote ou demote" }),
    participants: z.array(z.string().min(1)).min(1, "informe ao menos um participante"),
});

// PUT: Update group members (add, remove, promote, demote)
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
        const decodedJid = decodeURIComponent(jid);
        const lido = await lerCorpo(request, schema);
        if (!lido.ok) return lido.response;
        const { action, participants } = lido.data;

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const unsupported = requireCapability(sessionId, "groups");
        if (unsupported) return unsupported;

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // Execute the action
        const result = await instance.socket.groupParticipantsUpdate(
            decodedJid,
            participants,
            action as any
        );

        return NextResponse.json({ 
            success: true,
            message: `Successfully ${action}ed participants`,
            result
        });

    } catch (error: any) {
        console.error("Update group members error:", error);
        
        if (error.message?.includes("not-admin") || error.message?.includes("forbidden")) {
            return NextResponse.json({ status: false, message: "Bot must be admin to update group members", error: "Bot must be admin to update group members" }, { status: 403 });
        }
        
        if (error.message?.includes("not-authorized")) {
            return NextResponse.json({ status: false, message: "Not authorized to perform this action", error: "Not authorized to perform this action" }, { status: 403 });
        }
        
        return NextResponse.json({ status: false, message: "Failed to update group members", error: "Failed to update group members" }, { status: 500 });
    }
}
