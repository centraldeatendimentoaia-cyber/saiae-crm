import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { estadoPorChaves } from "@/modules/social/importar-pacote";

/** GET /api/social/importar-pacote/estado?keys=a,b | ?cliente=lavi&semana=2026-S47 — retorno de estado para polling da agência. */
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const q = new URL(request.url).searchParams;
    const keys = (q.get("keys") || "").split(",").map((k) => k.trim()).filter(Boolean);
    const itens = await estadoPorChaves(user.id, { keys, cliente: q.get("cliente") || undefined, semana: q.get("semana") || undefined });
    if (!itens) return NextResponse.json({ status: false, message: "Informe keys ou cliente + semana." }, { status: 400 });
    return NextResponse.json({ status: true, itens });
}
