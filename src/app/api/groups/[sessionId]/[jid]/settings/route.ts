import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { requireCapability } from "@/modules/whatsapp/provider/require";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { lerCorpo, opt } from "@/lib/validate";
import { z } from "zod";

const schema = z.object({
    setting: z.enum(["announcement", "not_announcement", "locked", "unlocked"], { error: "use announcement, not_announcement, locked ou unlocked" }),
    value: opt(z.any()),
});

// PUT: Update group settings
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
        const { setting, value } = lido.data;

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

        // Update group setting
        await instance.socket.groupSettingUpdate(decodedJid, setting as any);

        return NextResponse.json({ 
            success: true,
            message: `Group setting '${setting}' updated successfully`,
            setting
        });

    } catch (error: any) {
        console.error("Update group settings error:", error);
        
        if (error.message?.includes("not-admin") || error.message?.includes("forbidden")) {
            return NextResponse.json({ status: false, message: "Bot must be admin to update group settings", error: "Bot must be admin to update group settings" }, { status: 403 });
        }
        
        return NextResponse.json({ status: false, message: "Failed to update group settings", error: "Failed to update group settings" }, { status: 500 });
    }
}
