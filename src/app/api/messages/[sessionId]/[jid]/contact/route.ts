import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { requireCapability } from "@/modules/whatsapp/provider/require";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { fireSentWebhook } from "@/lib/webhook";
import { lerCorpo } from "@/lib/validate";
import { z } from "zod";

const schema = z.object({
    contacts: z.array(z.object({
        displayName: z.string().min(1, "informe o displayName de cada contato"),
        vcard: z.string().min(1, "informe o vcard de cada contato"),
    })).min(1, "informe ao menos um contato"),
});

// POST: Send contact card
export async function POST(
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
        const { contacts } = lido.data;

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const unsupported = requireCapability(sessionId, "contacts");
        if (unsupported) return unsupported;

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        const decodedJid = decodeURIComponent(jid);

        // Send contact message
        const sendResult = await instance.socket.sendMessage(decodedJid, {
            contacts: {
                displayName: contacts.length > 1 ? "Contacts" : contacts[0].displayName,
                contacts: contacts
            }
        });

        // Fire webhook for sent message (non-blocking)
        fireSentWebhook(sessionId, decodedJid, { type: 'contact', text: contacts[0]?.displayName || "" }, sendResult).catch(() => {});

        return NextResponse.json({ status: true, message: "Operation successful" });

    } catch (error) {
        console.error("Send contact error:", error);
        return NextResponse.json({ status: false, message: "Failed to send contact", error: "Failed to send contact" }, { status: 500 });
    }
}
