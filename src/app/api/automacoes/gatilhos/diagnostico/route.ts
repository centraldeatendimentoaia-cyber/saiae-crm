import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { diagnosticarGatilhos, PERMISSOES_DISPONIVEIS } from "@/modules/automacoes/gatilhos/catalogo";

// GET: cada gatilho da Meta com permissão exigida, estado e motivo (nunca devolve segredos nem valores de env)
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ status: true, data: { permissoesDoApp: PERMISSOES_DISPONIVEIS, gatilhos: diagnosticarGatilhos() } });
}
