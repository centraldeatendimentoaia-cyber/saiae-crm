import { NextRequest, NextResponse } from "next/server";
import { exigirSuperadmin } from "@/lib/admin-auth";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

/** Só SUPERADMIN com acesso à sessão (mesmo padrão de /api/agente/[sessionId]/config). Devolve o usuário ou a resposta de erro. */
export async function guardAtendente(request: NextRequest, sessionId: string): Promise<{ userId: string } | { negado: NextResponse }> {
    const negado = await exigirSuperadmin(request);
    if (negado) return { negado };
    const user = await getAuthenticatedUser(request);
    if (!user) return { negado: NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 }) };
    if (!(await canAccessSession(user.id, user.role, sessionId))) return { negado: NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 }) };
    return { userId: user.id };
}

export type Ctx = { params: Promise<{ sessionId: string }> };
