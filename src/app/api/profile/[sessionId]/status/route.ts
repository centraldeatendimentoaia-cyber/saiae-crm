import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { waManager } from "@/modules/whatsapp/manager";
import { lerCorpo } from "@/lib/validate";
import { z } from "zod";

// texto vazio limpa o recado
const schema = z.object({ status: z.string({ error: "informe o texto do recado" }) });

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
        const { status } = lido.data;

        const instance = waManager.getInstance(sessionId);
        if (!instance || !instance.socket) {
            return NextResponse.json({ status: false, message: "WhatsApp instance not connected" }, { status: 503 });
        }

        // WhatsApp Baileys updates status (about info)
        await instance.socket.updateProfileStatus(status);

        return NextResponse.json({ status: true, message: "Profile status updated" });

    } catch (error: any) {
        console.error("Update profile status error:", error);
        return NextResponse.json({ status: false, message: error.message }, { status: 500 });
    }
}
