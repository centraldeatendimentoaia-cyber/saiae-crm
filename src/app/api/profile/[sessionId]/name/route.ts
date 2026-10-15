import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";
import { lerCorpo } from "@/lib/validate";
import { z } from "zod";

const schema = z.object({ name: z.string().min(1, "informe o nome") });

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
        }

        const lido = await lerCorpo(request, schema);
        if (!lido.ok) return lido.response;
        const { name } = lido.data;

        const instance = waManager.getInstance(sessionId);
        if (!instance || !instance.socket) {
            return NextResponse.json({ status: false, message: "WhatsApp instance not connected" }, { status: 503 });
        }

        // WhatsApp Baileys updates profile name
        await instance.socket.updateProfileName(name);

        return NextResponse.json({ status: true, message: "Profile name updated" });

    } catch (error: any) {
        console.error("Update profile name error:", error);
        return NextResponse.json({ status: false, message: error.message }, { status: 500 });
    }
}
