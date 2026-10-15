import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { requireCapability } from "@/modules/whatsapp/provider/require";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { fireSentWebhook } from "@/lib/webhook";
import { lerCorpo, opt } from "@/lib/validate";
import { z } from "zod";

const schema = z.object({
    latitude: z.coerce.number({ error: "informe a latitude" }).min(-90, "a latitude deve estar entre -90 e 90").max(90, "a latitude deve estar entre -90 e 90"),
    longitude: z.coerce.number({ error: "informe a longitude" }).min(-180, "a longitude deve estar entre -180 e 180").max(180, "a longitude deve estar entre -180 e 180"),
    name: opt(z.string()),
    address: opt(z.string()),
});

// POST: Send location message
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string }> }
) {
    try {
        const { sessionId, jid: rawJid } = await params;
        const jid = decodeURIComponent(rawJid);

        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const lido = await lerCorpo(request, schema);
        if (!lido.ok) return lido.response;
        const { latitude, longitude, name, address } = lido.data;

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const unsupported = requireCapability(sessionId, "locations");
        if (unsupported) return unsupported;

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // Send location message
        const sendResult = await instance.socket.sendMessage(jid, {
            location: {
                degreesLatitude: latitude,
                degreesLongitude: longitude,
                name: name || undefined,
                address: address || undefined
            }
        });

        // Fire webhook for sent message (non-blocking)
        fireSentWebhook(sessionId, jid, { type: 'location', text: name || address || `${latitude},${longitude}` }, sendResult).catch(() => {});

        return NextResponse.json({ status: true, message: "Operation successful" });

    } catch (error) {
        console.error("Send location error:", error);
        return NextResponse.json({ status: false, message: "Failed to send location", error: "Failed to send location" }, { status: 500 });
    }
}
