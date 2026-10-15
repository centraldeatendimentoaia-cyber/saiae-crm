import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { requireCapability } from "@/modules/whatsapp/provider/require";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { fireSentWebhook } from "@/lib/webhook";
import { lerCorpo, opt } from "@/lib/validate";
import { z } from "zod";

const schema = z.object({
    question: z.string().min(1, "informe a pergunta"),
    options: z.array(z.string()).min(2, "a enquete precisa de 2 a 12 opções").max(12, "a enquete precisa de 2 a 12 opções"),
    selectableCount: opt(z.coerce.number().int()),
}).refine((b) => (b.selectableCount || 1) >= 1 && (b.selectableCount || 1) <= b.options.length, {
    path: ["selectableCount"],
    message: "deve estar entre 1 e o número de opções",
});

// POST: Send poll message
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
        const { question, options, selectableCount } = lido.data;
        const count = selectableCount || 1;

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const unsupported = requireCapability(sessionId, "polls");
        if (unsupported) return unsupported;

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // Send poll message
        const sendResult = await instance.socket.sendMessage(jid, {
            poll: {
                name: question,
                values: options,
                selectableCount: count
            }
        });

        // Fire webhook for sent message (non-blocking)
        fireSentWebhook(sessionId, jid, { type: 'poll', text: question }, sendResult).catch(() => {});

        return NextResponse.json({ status: true, message: "Operation successful" });

    } catch (error) {
        console.error("Send poll error:", error);
        return NextResponse.json({ status: false, message: "Failed to send poll", error: "Failed to send poll" }, { status: 500 });
    }
}
