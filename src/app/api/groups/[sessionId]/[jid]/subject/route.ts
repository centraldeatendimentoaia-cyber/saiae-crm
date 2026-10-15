import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { requireCapability } from "@/modules/whatsapp/provider/require";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { lerCorpo } from "@/lib/validate";
import { z } from "zod";

const schema = z.object({ subject: z.string().min(1, "informe o assunto").max(100, "o assunto pode ter no máximo 100 caracteres") });

// PUT: Update group subject/name
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
        const { subject } = lido.data;

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

        // Update group subject
        await instance.socket.groupUpdateSubject(decodedJid, subject);

        return NextResponse.json({ 
            success: true, 
            message: "Group subject updated successfully",
            subject 
        });

    } catch (error: any) {
        console.error("Update group subject error:", error);
        
        // Handle specific errors
        if (error.message?.includes("not-admin") || error.message?.includes("forbidden")) {
            return NextResponse.json({ status: false, message: "Bot must be admin to update group subject", error: "Bot must be admin to update group subject" }, { status: 403 });
        }
        
        return NextResponse.json({ status: false, message: "Failed to update group subject", error: "Failed to update group subject" }, { status: 500 });
    }
}
