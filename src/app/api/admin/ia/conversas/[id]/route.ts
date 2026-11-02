import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirSuperadmin } from "@/lib/admin-auth";
import { formatPhoneBr } from "@/lib/phone";
import { jidsDaConversa, PREFIXO_AGENTE } from "@/modules/agente-salao/conversas-admin";

/** GET /api/admin/ia/conversas/:id — a conversa inteira (até as últimas 300 mensagens) e o lead. Só SUPERADMIN. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const negado = await exigirSuperadmin(request);
    if (negado) return negado;
    const { id } = await params;

    if (id.startsWith(PREFIXO_AGENTE)) {
        const a = await prisma.agenteConversa.findUnique({ where: { id: id.slice(PREFIXO_AGENTE.length) } });
        if (!a) return NextResponse.json({ status: false, message: "Not found" }, { status: 404 });
        const sessao = await prisma.session.findUnique({ where: { sessionId: a.sessionId }, select: { id: true, name: true } });
        const msgs = sessao
            ? await prisma.message.findMany({
                where: { sessionId: sessao.id, remoteJid: { in: jidsDaConversa(a) }, content: { not: null } },
                orderBy: [{ timestamp: "desc" }, { id: "desc" }],
                take: 300,
                select: { keyId: true, fromMe: true, content: true, timestamp: true },
            })
            : [];
        // quem escreveu o que saiu do número: a IA, o painel (CRM) ou uma pessoa pelo celular
        const origens = msgs.length ? await prisma.mensagemOrigem.findMany({ where: { sessionId: a.sessionId, keyId: { in: msgs.map((m) => m.keyId) } }, select: { keyId: true, origem: true } }) : [];
        const origemDe = new Map(origens.map((o) => [o.keyId, o.origem]));
        const agora = new Date();
        return NextResponse.json({
            status: true,
            data: {
                id,
                lojaCodigo: sessao?.name ?? "WhatsApp",
                telefone: a.telefone ? formatPhoneBr(a.telefone) : a.jid.split("@")[0],
                estado: a.estado === "humano" && a.pausadaAte && a.pausadaAte > agora ? "humano" : "ia",
                pausadaAte: a.pausadaAte,
                mensagens: msgs.reverse().map((m) => ({
                    direcao: m.fromMe ? "out" : "in",
                    texto: m.content ?? "",
                    criadoEm: m.timestamp,
                    autor: !m.fromMe ? "Cliente" : origemDe.get(m.keyId) === "ia" ? "IA" : origemDe.get(m.keyId) === "crm" ? "Equipe (painel)" : "Equipe (celular)",
                })),
                lead: a.nomePerfil || a.servico ? { nome: a.nomePerfil, negocio: a.servico, cidade: null, origem: "whatsapp" } : null,
                somenteLeitura: true,
            },
        });
    }

    const c = await prisma.iaConversa.findUnique({
        where: { id },
        include: { mensagens: { orderBy: { criadoEm: "desc" }, take: 300, select: { direcao: true, texto: true, criadoEm: true } } },
    });
    if (!c) return NextResponse.json({ status: false, message: "Not found" }, { status: 404 });
    const lead = await prisma.iaLead.findUnique({ where: { contactKey: c.contactKey } });
    const agora = new Date();

    return NextResponse.json({
        status: true,
        data: {
            id: c.id,
            lojaCodigo: c.lojaCodigo,
            telefone: formatPhoneBr(c.contactKey),
            estado: c.estado === "humano" && c.pausadaAte && c.pausadaAte > agora ? "humano" : "ia",
            pausadaAte: c.pausadaAte,
            mensagens: [...c.mensagens].reverse(),
            lead: lead ? { nome: lead.nome, negocio: lead.negocio, cidade: lead.cidade, origem: lead.origem } : null,
        },
    });
}

/** DELETE /api/admin/ia/conversas/:id — apaga a conversa (e as mensagens) e o lead do mesmo telefone. Só SUPERADMIN. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const negado = await exigirSuperadmin(request);
    if (negado) return negado;
    const { id } = await params;
    if (id.startsWith(PREFIXO_AGENTE)) return NextResponse.json({ status: false, message: "Conversas do agente do negócio não são apagadas por aqui" }, { status: 400 });

    const c = await prisma.iaConversa.findUnique({ where: { id }, select: { contactKey: true } });
    if (!c) return NextResponse.json({ status: true, data: { apagada: false } });
    await prisma.iaConversa.delete({ where: { id } });
    await prisma.iaLead.deleteMany({ where: { contactKey: c.contactKey } });
    return NextResponse.json({ status: true, data: { apagada: true } });
}
