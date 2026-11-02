import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirSuperadmin } from "@/lib/admin-auth";
import { formatPhoneBr } from "@/lib/phone";
import { jidsDaConversa, PREFIXO_AGENTE, PREFIXO_NEGOCIO } from "@/modules/agente-salao/conversas-admin";

/**
 * GET /api/admin/ia/conversas?loja=VENDAS&q=6199&estado=ia|humano&limite=50
 * Lista as conversas da atendente IA (API oficial), da mais recente para a mais antiga. Só SUPERADMIN.
 * `loja`: "VENDAS" (atendente de vendas do Saiaê, padrão), "TODAS", o código de uma loja ou "WA:<sessionId>" (conversas do
 * agente de um negócio, ou seja, de um número de WhatsApp conectado).
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

    // Negócios (números de WhatsApp com agente de IA): cada um tem as próprias conversas, fora da tabela das lojas/vendas.
    const porNegocio = await prisma.agenteConversa.groupBy({ by: ["sessionId"], _count: { _all: true } });
    const sessoes = porNegocio.length
        ? await prisma.session.findMany({ where: { sessionId: { in: porNegocio.map((n) => n.sessionId) } }, select: { sessionId: true, name: true } })
        : [];
    const nomeDe = new Map(sessoes.map((s) => [s.sessionId, s.name]));
    const negocios = porNegocio.map((n) => ({ codigo: `${PREFIXO_NEGOCIO}${n.sessionId}`, nome: nomeDe.get(n.sessionId) ?? "WhatsApp", total: n._count._all }));

    if (loja.startsWith(PREFIXO_NEGOCIO)) {
        const token = loja.slice(PREFIXO_NEGOCIO.length);
        const sessao = await prisma.session.findUnique({ where: { sessionId: token }, select: { id: true, name: true } });
        const filtro: Record<string, unknown> = { sessionId: token };
        if (busca) filtro.telefone = { contains: busca };
        if (estado === "humano") Object.assign(filtro, { estado: "humano", pausadaAte: { gt: agora } });
        if (estado === "ia") Object.assign(filtro, { OR: [{ estado: "ia" }, { pausadaAte: null }, { pausadaAte: { lte: agora } }] });
        const agentes = await prisma.agenteConversa.findMany({ where: filtro, orderBy: { atualizadoEm: "desc" }, take: limite });
        const ultimas = await Promise.all(agentes.map((a) =>
            sessao ? prisma.message.findFirst({ where: { sessionId: sessao.id, remoteJid: { in: jidsDaConversa(a) }, content: { not: null } }, orderBy: [{ timestamp: "desc" }, { id: "desc" }], select: { fromMe: true, content: true, timestamp: true } }) : null));
        return NextResponse.json({
            status: true,
            data: {
                conversas: agentes.map((a, i) => ({
                    id: `${PREFIXO_AGENTE}${a.id}`,
                    lojaCodigo: sessao?.name ?? "WhatsApp",
                    telefone: a.telefone ? formatPhoneBr(a.telefone) : a.jid.split("@")[0],
                    estado: a.estado === "humano" && a.pausadaAte && a.pausadaAte > agora ? "humano" : "ia",
                    pausadaAte: a.pausadaAte,
                    ultimaMensagemEm: ultimas[i]?.timestamp ?? a.atualizadoEm,
                    ultima: ultimas[i] ? { direcao: ultimas[i]!.fromMe ? "out" : "in", texto: (ultimas[i]!.content ?? "").slice(0, 140) } : null,
                    lead: a.nomePerfil || a.servico ? { nome: a.nomePerfil, negocio: a.servico, cidade: null, origem: "whatsapp" } : null,
                })),
                lojas: [],
                negocios,
            },
        });
    }

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
            negocios,
        },
    });
}
