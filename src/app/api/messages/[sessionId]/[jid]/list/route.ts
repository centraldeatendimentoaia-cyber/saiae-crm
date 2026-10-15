import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { requireCapability } from "@/modules/whatsapp/provider/require";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { lerCorpo, opt } from "@/lib/validate";
import { z } from "zod";

const schema = z.object({
    title: z.string().min(1, "informe o título"),
    options: z.array(z.any()).min(1, "informe ao menos uma opção"),
    footer: opt(z.string()),
});

// POST: Send formatted text message with options (List/Button alternative)
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
        const { title, options, footer } = lido.data;

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const unsupported = requireCapability(sessionId, "lists");
        if (unsupported) return unsupported;

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // Format text with title and options list
        let formattedText = `*${title}*\n\n`;
        options.forEach((option: string, index: number) => {
            formattedText += `${index + 1}. ${option}\n`;
        });
        if (footer) {
            formattedText += `\n_${footer}_`;
        }

        // Send formatted text message
        await instance.socket.sendMessage(jid, {
            text: formattedText
        });

        return NextResponse.json({ status: true, message: "Operation successful" });

    } catch (error) {
        console.error("Send list error:", error);
        return NextResponse.json({ status: false, message: "Failed to send list message", error: "Failed to send list message" }, { status: 500 });
    }
}
