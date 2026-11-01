import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { configuracaoMeta, criarEstado, urlDeAutorizacao, urlDeRetorno } from "@/modules/social/oauth";

const VOLTA = "/dashboard/redes-sociais/contas";

/** GET /api/social/oauth/start — leva o usuário logado à tela de login/autorização da Meta. */
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const cfg = configuracaoMeta();
    if (!cfg) return NextResponse.redirect(new URL(`${VOLTA}?oauth=nao-configurado`, request.nextUrl.origin));

    const estado = criarEstado(user.id, cfg.appSecret);
    return NextResponse.redirect(urlDeAutorizacao(cfg.appId, urlDeRetorno(request.nextUrl.origin), estado));
}
