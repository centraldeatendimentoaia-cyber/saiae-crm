import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";

/**
 * POST: força o WhatsApp a reenviar o estado do app (etiquetas e conversas etiquetadas).
 * As etiquetas chegam pelos eventos "labels.edit"/"labels.association" ligados em instance.ts.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params;
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
        }
        if (!(await canAccessSession(user.id, user.role, sessionId))) {
            return NextResponse.json({ status: false, error: "Forbidden" }, { status: 403 });
        }

        const socket: any = waManager.getInstance(sessionId)?.socket;
        if (!socket) {
            return NextResponse.json(
                { status: false, error: "Sessão não está conectada. Conecte o WhatsApp primeiro." },
                { status: 503 }
            );
        }

        // Diagnóstico: etiquetas só existem em contas WhatsApp Business
        let isBusiness: boolean | null = null;
        try {
            const jid = String(socket.user?.id || "").replace(/:\d+@/, "@");
            const profile = jid ? await socket.getBusinessProfile(jid) : null;
            isBusiness = !!profile;
        } catch {
            isBusiness = null;
        }

        let syncError: string | null = null;
        try {
            await socket.resyncAppState(["regular", "regular_low", "regular_high", "critical_block", "critical_unblock_low"], true);
        } catch (e: any) {
            syncError = e?.message || String(e);
            console.error("Label resync error:", syncError);
        }

        // Dá um tempo para os eventos chegarem e serem gravados
        await new Promise((r) => setTimeout(r, 4000));

        const [labels, associations] = await Promise.all([
            prisma.label.count({ where: { sessionId } }),
            prisma.chatLabel.count({ where: { label: { sessionId } } }),
        ]);

        return NextResponse.json({ status: true, data: { labels, associations, isBusiness, syncError } });
    } catch (error) {
        console.error("Sync labels error:", error);
        return NextResponse.json({ status: false, error: "Internal Server Error" }, { status: 500 });
    }
}
