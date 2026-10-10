import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirSuperadmin } from "@/lib/admin-auth";
import { formatPhoneBr } from "@/lib/phone";

/**
 * GET /api/admin/ia/conversas?loja=VENDAS&q=6199&estado=ia|humano&limite=50
 * Lista as conversas da atendente IA (API oficial), da mais recente para a mais antiga. Só SUPERADMIN.
 * `loja`: "VENDAS" (atendente de vendas do Saiaê, padrão), "TODAS" ou o código de uma loja.
 * Nunca registra telefone nem texto em log.
 */
export async function GET(request: NextRequest) {
    const negado = await exigirSuperadmin(request);
    if (negado) return negado;

    const q = new URL(request.url).searchParams;
    const loja = (q.get("loja") || "VENDAS").trim();
    const busca = (q.get("q") || "").replace(/\D/g, "");
    const estado = q.get("estado");
    const limite = Math.min(Math.max(parseInt(q.get("limite") || "50", 10) || 50, 1), 200);
    const agora = new Date();

    const where: Record<string, unknown> = {};
    if (loja.toUpperCase() !== "TODAS") where.lojaCodigo = loja;
    if (busca) where.contactKey = { contains: busca };
    if (estado === "humano") Object.assign(where, { estado: "humano", pausadaAte: { gt: agora } });
    if (estado === "ia") Object.assign(where, { OR: [{ estado: "ia" }, { pausadaAte: null }, { pausadaAte: { lte: agora } }] });

    const [conversas, lojas] = await Promise.all([
        prisma.iaConversa.findMany({
            where,
            orderBy: { ultimaMensagemEm: "desc" },
            take: limite,
            include: { mensagens: { orderBy: { criadoEm: "desc" }, take: 1, select: { direcao: true, texto: true, criadoEm: true } } },
        }),
        prisma.iaConversa.groupBy({ by: ["lojaCodigo"], _count: { _all: true }, orderBy: { _count: { lojaCodigo: "desc" } }, take: 30 }),
    ]);

    const chaves = conversas.map((c) => c.contactKey);
    const leads = chaves.length ? await prisma.iaLead.findMany({ where: { contactKey: { in: chaves } } }) : [];
    const leadDe = new Map(leads.map((l) => [l.contactKey, l]));

    return NextResponse.json({
        status: true,
        data: {
            conversas: conversas.map((c) => {
                const ultima = c.mensagens[0];
                const lead = leadDe.get(c.contactKey);
                return {
                    id: c.id,
                    lojaCodigo: c.lojaCodigo,
                    telefone: formatPhoneBr(c.contactKey),
                    estado: c.estado === "humano" && c.pausadaAte && c.pausadaAte > agora ? "humano" : "ia",
                    pausadaAte: c.pausadaAte,
                    ultimaMensagemEm: c.ultimaMensagemEm,
                    ultima: ultima ? { direcao: ultima.direcao, texto: ultima.texto.slice(0, 140) } : null,
                    lead: lead ? { nome: lead.nome, negocio: lead.negocio, cidade: lead.cidade, origem: lead.origem } : null,
                };
            }),
            lojas: lojas.map((l) => ({ codigo: l.lojaCodigo, total: l._count._all })),
        },
    });
}
