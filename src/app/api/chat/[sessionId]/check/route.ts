import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { lerCorpo } from "@/lib/validate";
import { z } from "zod";

const schema = z.object({ numbers: z.array(z.string().min(1)).min(1, "informe ao menos um número").max(50, "verifique no máximo 50 números por vez") });

// POST: Check if number is on WhatsApp
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const lido = await lerCorpo(request, schema);
        if (!lido.ok) return lido.response;
        const { numbers } = lido.data;

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        // Check numbers on WhatsApp
        const results = await Promise.all(
            numbers.map(async (number: string) => {
                try {
                    const checkResult = await instance.socket!.onWhatsApp(number);
                    // onWhatsApp returns array of results
                    const result = Array.isArray(checkResult) && checkResult.length > 0 ? checkResult[0] : null;
                    return {
                        number,
                        exists: result?.exists || false,
                        jid: result?.jid || null
                    };
                } catch (error) {
                    return {
                        number,
                        exists: false,
                        jid: null,
                        error: "Invalid number format"
                    };
                }
            })
        );

        return NextResponse.json({ status: true, message: "Operation successful", data: { results } });

    } catch (error) {
        console.error("Check WhatsApp error:", error);
        return NextResponse.json({ status: false, message: "Failed to check numbers", error: "Failed to check numbers" }, { status: 500 });
    }
}
