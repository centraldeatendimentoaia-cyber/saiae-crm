import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";

/** Só SUPERADMIN. Devolve null se pode seguir, ou a resposta de erro pronta (401/403). */
export async function exigirSuperadmin(request: NextRequest): Promise<NextResponse | null> {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    if (user.role !== "SUPERADMIN") return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
    return null;
}
