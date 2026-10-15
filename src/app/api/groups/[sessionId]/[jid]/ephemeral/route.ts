import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { requireCapability } from "@/modules/whatsapp/provider/require";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { lerCorpo } from "@/lib/validate";
import { z } from "zod";

// duração em segundos: 0 (desligado), 1 dia, 7 dias ou 90 dias
const schema = z.object({
    expiration: z.union([z.literal(0), z.literal(86400), z.literal(604800), z.literal(7776000)], { error: "use 0 (desligado), 86400 (1 dia), 604800 (7 dias) ou 7776000 (90 dias)" }),
});

// PUT: Toggle ephemeral/disappearing messages
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
        const { expiration } = lido.data;

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

        // Toggle ephemeral messages
        await instance.socket.groupToggleEphemeral(decodedJid, expiration);

        const expirationLabels: Record<number, string> = {
            0: 'off',
            86400: '1 day',
            604800: '7 days',
            7776000: '90 days'
        };

        return NextResponse.json({ 
            success: true,
            message: `Disappearing messages ${expiration === 0 ? 'disabled' : 'enabled'}`,
            expiration,
            expirationLabel: expirationLabels[expiration]
        });

    } catch (error: any) {
        console.error("Toggle ephemeral error:", error);
        
        if (error.message?.includes("not-admin") || error.message?.includes("forbidden")) {
            return NextResponse.json({ status: false, message: "Bot must be admin to toggle ephemeral messages", error: "Bot must be admin to toggle ephemeral messages" }, { status: 403 });
        }
        
        return NextResponse.json({ status: false, message: "Failed to toggle ephemeral messages", error: "Failed to toggle ephemeral messages" }, { status: 500 });
    }
}
