import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { formatarConversa } from "@/modules/ia-atendimento/avaliacao/anonimizar";

/**
 * GET /api/admin/ia-vendas-conversas?dias=30&limite=200
 * Baixa, em texto, as conversas da atendente de vendas já ANONIMIZADAS (sem telefone, e-mail, links de fora nem nome
 * quando a pessoa se apresenta) para treinar a atendente fora do sistema. Só SUPERADMIN. Não grava nada.
 * A IA guarda no máximo 30 dias de conversa, então "dias" passa disso não traz mais.
 */
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    if (user.role !== "SUPERADMIN") return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });

    const q = new URL(request.url).searchParams;
    const dias = Math.min(Math.max(parseInt(q.get("dias") || "30", 10) || 30, 1), 30);
    const limite = Math.min(Math.max(parseInt(q.get("limite") || "200", 10) || 200, 1), 500);
    const desde = new Date(Date.now() - dias * 86_400_000);

    const conversas = await prisma.iaConversa.findMany({
        where: { lojaCodigo: "VENDAS", ultimaMensagemEm: { gte: desde } },
        orderBy: { ultimaMensagemEm: "desc" },
        take: limite,
        include: { mensagens: { where: { criadoEm: { gte: desde } }, orderBy: { criadoEm: "asc" }, select: { direcao: true, texto: true, criadoEm: true } } },
    });

    const corpo = [
        `# Conversas da atendente de vendas, anonimizadas (${conversas.length} conversas, últimos ${dias} dias)`,
        "# Revise antes de compartilhar: a anonimização é automática e pode deixar passar algum dado.",
        "",
        ...conversas.filter((c) => c.mensagens.length > 0).map((c, i) => formatarConversa(i + 1, c.mensagens)),
    ].join("\n");

    return new NextResponse(corpo, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": 'attachment; filename="conversas-vendas-anonimizadas.txt"',
            "Cache-Control": "no-store",
        },
    });
}
