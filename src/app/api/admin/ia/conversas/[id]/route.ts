import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirSuperadmin } from "@/lib/admin-auth";
import { formatPhoneBr } from "@/lib/phone";

/** GET /api/admin/ia/conversas/:id — a conversa inteira (até as últimas 300 mensagens) e o lead. Só SUPERADMIN. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const negado = await exigirSuperadmin(request);
    if (negado) return negado;
    const { id } = await params;

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

    const c = await prisma.iaConversa.findUnique({ where: { id }, select: { contactKey: true } });
    if (!c) return NextResponse.json({ status: true, data: { apagada: false } });
    await prisma.iaConversa.delete({ where: { id } });
    await prisma.iaLead.deleteMany({ where: { contactKey: c.contactKey } });
    return NextResponse.json({ status: true, data: { apagada: true } });
}
