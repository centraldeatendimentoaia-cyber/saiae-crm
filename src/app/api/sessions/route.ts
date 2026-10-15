import { NextResponse, NextRequest } from "next/server";
import { assertCanCreateSession, PlanError } from "@/lib/plans";
import { waManager } from "@/modules/whatsapp/manager";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, getAccessibleSessions } from "@/lib/api-auth";
import { lerCorpo, opt } from "@/lib/validate";
import { z } from "zod";

const schema = z.object({
    name: z.string().min(1, "informe o nome da sessão").max(100, "o nome da sessão pode ter no máximo 100 caracteres"),
    sessionId: opt(z.string().min(1).max(100)),
});

export const dynamic = 'force-dynamic';

// GET: Fetch sessions (filtered by user role)
export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        // Get sessions based on user role
        const sessions = await getAccessibleSessions(user.id, user.role);
        return NextResponse.json({ status: true, message: "Sessions retrieved successfully", data: sessions });
    } catch (error) {
        console.error("Get sessions error:", error);
        return NextResponse.json({ status: false, message: "Failed to fetch sessions", error: "Failed to fetch sessions" }, { status: 500 });
    }
}

// POST: Create new session (always for the authenticated user)
export async function POST(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const lido = await lerCorpo(request, schema);
        if (!lido.ok) return lido.response;
        const { name, sessionId } = lido.data;

        await assertCanCreateSession(user.id);

        // Create session for the authenticated user
        const session = await waManager.createSession(user.id, name, sessionId);
        return NextResponse.json({ status: true, message: "Session created successfully", data: session });
    } catch (error) {
        if (error instanceof PlanError) {
            return NextResponse.json({ status: false, message: error.message, error: error.message, code: "PLAN_LIMIT" }, { status: 402 });
        }
        console.error("Create session error:", error);
        return NextResponse.json({ status: false, message: "Failed to create session", error: "Failed to create session" }, { status: 500 });
    }
}
