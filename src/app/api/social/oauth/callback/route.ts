import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { logger } from "@/lib/logger";
import { discoverAccounts } from "@/modules/social/graph";
import { configuracaoMeta, lerEstado, trocarCodigoPorToken, urlDeRetorno } from "@/modules/social/oauth";
import { salvarContas } from "@/modules/social/salvar-contas";

const VOLTA = "/dashboard/redes-sociais/contas";

/** GET /api/social/oauth/callback — retorno da Meta: troca o código, descobre Páginas/Instagram e guarda o token de cada Página. */
export async function GET(request: NextRequest) {
    const origin = request.nextUrl.origin;
    const voltar = (qs: string) => NextResponse.redirect(new URL(`${VOLTA}?${qs}`, origin));

    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });

    const cfg = configuracaoMeta();
    if (!cfg) return voltar("oauth=nao-configurado");

    const params = request.nextUrl.searchParams;
    if (params.get("error")) return voltar("oauth=negado"); // o usuário cancelou ou recusou as permissões

    const code = params.get("code");
    const dono = lerEstado(params.get("state") ?? "", cfg.appSecret);
    if (!code || dono !== user.id) return voltar("oauth=invalido");

    try {
        const token = await trocarCodigoPorToken(code, urlDeRetorno(origin), cfg.appId, cfg.appSecret);
        const found = await discoverAccounts(token);
        if (!found.length) return voltar("oauth=sem-paginas");
        const semIg = await salvarContas(user.id, found);
        return voltar(`oauth=ok&n=${found.length}${semIg.length ? `&semig=${encodeURIComponent(semIg.join(", "))}` : ""}`);
    } catch (e) {
        logger.warn("SocialOAuth", `falha ao conectar: ${e instanceof Error ? e.message : "erro"}`);
        return voltar("oauth=erro");
    }
}
