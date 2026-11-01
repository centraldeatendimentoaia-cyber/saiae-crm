import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "@/lib/logger";
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

/** Erro de publicar/reverter: treino inválido = 409 com mensagem clara; qualquer outra coisa = 500 genérico, só o tipo no log. */
export function respostaErroAcao(e: unknown): NextResponse {
    if (e instanceof ZodError) return NextResponse.json({ status: false, message: "O treino salvo está inválido. Corrija o rascunho e salve de novo." }, { status: 409 });
    logger.warn("Atendente", `falha na rota de treino: ${(e as { name?: string })?.name ?? "erro"}`);
    return NextResponse.json({ status: false, message: "Não foi possível concluir agora. Tente de novo em instantes." }, { status: 500 });
}

export type Ctx = { params: Promise<{ sessionId: string }> };
