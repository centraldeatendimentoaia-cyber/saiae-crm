import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirSuperadmin } from "@/lib/admin-auth";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { CONHECIMENTO_LAVINIA_PADRAO } from "@/modules/agente-salao/conhecimento-lavinia";
import { limparCacheConfigAgente } from "@/modules/agente-salao/agente";
import { ETIQUETAS_INTERESSE_PADRAO } from "@/modules/agente-salao/motor";
import { MSG_SESSAO_DE_BARRACA, limparCacheBarraca } from "@/modules/agente-salao/barraca";

// Só SUPERADMIN, igual à página /dashboard/agente-ia.
async function guard(request: NextRequest, sessionId: string) {
    const negado = await exigirSuperadmin(request);
    if (negado) return negado;
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    if (!(await canAccessSession(user.id, user.role, sessionId))) return NextResponse.json({ status: false, message: "Forbidden" }, { status: 403 });
    return null;
}

const corpo = z.object({
    ativo: z.boolean().optional(),
    nome: z.string().trim().min(1).max(40).optional(),
    nomeNegocio: z.string().trim().max(60).nullable().optional(),
    emailAviso: z.string().trim().max(120).nullable().optional().refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "E-mail inválido"),
    followUpTexto: z.string().trim().max(500).nullable().optional(),
    etiquetasInteresse: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    etiquetaAguardando: z.string().trim().max(80).nullable().optional(),
    etiquetaFollowUp: z.string().trim().max(80).nullable().optional(),
    etiquetaAnuncio: z.string().trim().max(80).nullable().optional(),
    conhecimento: z.string().max(40_000).nullable().optional(),
    promocoes: z.string().max(4_000).nullable().optional(),
    linkAgendamento: z.string().trim().max(300).nullable().optional().refine((v) => !v || /^https:\/\/\S+$/i.test(v), "O link precisa começar com https://"),
    grupoRecepcaoJid: z.string().trim().max(100).nullable().optional().refine((v) => !v || v.endsWith("@g.us"), "Escolha um grupo do WhatsApp"),
    numerosIgnorados: z.array(z.string().regex(/^\d{8,15}$/)).max(100).optional(),
    followUpHoras: z.number().int().min(1).max(30).optional(),
    pausaHoras: z.number().int().min(1).max(72).optional(),
    horaAbre: z.number().int().min(0).max(23).optional(),
    horaFecha: z.number().int().min(1).max(24).optional(),
    diasAbertos: z.string().regex(/^[0-6](,[0-6])*$/).optional(),
});

/** GET: configuração do agente da sessão (com o texto padrão da Lavínia quando o dono ainda não editou). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const { sessionId } = await params;
    const negado = await guard(request, sessionId);
    if (negado) return negado;
    const c = await prisma.agenteConfig.findUnique({ where: { sessionId } });
    return NextResponse.json({
        status: true,
        data: {
            ativo: c?.ativo ?? false,
            nome: c?.nome ?? "Lavínia",
            nomeNegocio: c?.nomeNegocio ?? "",
            emailAviso: c?.emailAviso ?? "",
            followUpTexto: c?.followUpTexto ?? "",
            etiquetasInteresse: Array.isArray(c?.etiquetasInteresse) ? c!.etiquetasInteresse : [...ETIQUETAS_INTERESSE_PADRAO],
            etiquetaAguardando: c ? c.etiquetaAguardando ?? "" : "Aguardando resposta",
            etiquetaFollowUp: c ? c.etiquetaFollowUp ?? "" : "Sumiu - follow up",
            etiquetaAnuncio: c ? c.etiquetaAnuncio ?? "" : "Vindo de anúncio do Meta",
            conhecimento: c?.conhecimento?.trim() ? c.conhecimento : CONHECIMENTO_LAVINIA_PADRAO,
            promocoes: c?.promocoes ?? "",
            linkAgendamento: c?.linkAgendamento ?? "",
            grupoRecepcaoJid: c?.grupoRecepcaoJid ?? "",
            numerosIgnorados: Array.isArray(c?.numerosIgnorados) ? c!.numerosIgnorados : [],
            followUpHoras: c?.followUpHoras ?? 12,
            pausaHoras: c?.pausaHoras ?? 12,
            diasAbertos: c?.diasAbertos ?? "2,3,4,5,6",
            horaAbre: c?.horaAbre ?? 9,
            horaFecha: c?.horaFecha ?? 18,
            conhecimentoPadrao: CONHECIMENTO_LAVINIA_PADRAO,
        },
    });
}

/** PUT: salva (parcial). Para voltar ao texto padrão da Lavínia, envie conhecimento: null. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const { sessionId } = await params;
    const negado = await guard(request, sessionId);
    if (negado) return negado;
    const sessao = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!sessao) return NextResponse.json({ status: false, message: "Session not found" }, { status: 404 });

    const parsed = corpo.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ status: false, message: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    const d = parsed.data;
    const dados = {
        ...(d.ativo !== undefined ? { ativo: d.ativo } : {}),
        ...(d.nome !== undefined ? { nome: d.nome } : {}),
        ...(d.nomeNegocio !== undefined ? { nomeNegocio: d.nomeNegocio?.trim() || null } : {}),
        ...(d.emailAviso !== undefined ? { emailAviso: d.emailAviso?.trim() || null } : {}),
        ...(d.followUpTexto !== undefined ? { followUpTexto: d.followUpTexto?.trim() || null } : {}),
        ...(d.etiquetasInteresse !== undefined ? { etiquetasInteresse: d.etiquetasInteresse } : {}),
        ...(d.etiquetaAguardando !== undefined ? { etiquetaAguardando: d.etiquetaAguardando?.trim() || null } : {}),
        ...(d.etiquetaFollowUp !== undefined ? { etiquetaFollowUp: d.etiquetaFollowUp?.trim() || null } : {}),
        ...(d.etiquetaAnuncio !== undefined ? { etiquetaAnuncio: d.etiquetaAnuncio?.trim() || null } : {}),
        ...(d.conhecimento !== undefined ? { conhecimento: d.conhecimento && d.conhecimento.trim() !== CONHECIMENTO_LAVINIA_PADRAO.trim() ? d.conhecimento : null } : {}),
        ...(d.promocoes !== undefined ? { promocoes: d.promocoes?.trim() || null } : {}),
        ...(d.linkAgendamento !== undefined ? { linkAgendamento: d.linkAgendamento || null } : {}),
        ...(d.grupoRecepcaoJid !== undefined ? { grupoRecepcaoJid: d.grupoRecepcaoJid || null } : {}),
        ...(d.numerosIgnorados !== undefined ? { numerosIgnorados: d.numerosIgnorados } : {}),
        ...(d.followUpHoras !== undefined ? { followUpHoras: d.followUpHoras } : {}),
        ...(d.pausaHoras !== undefined ? { pausaHoras: d.pausaHoras } : {}),
        ...(d.horaAbre !== undefined ? { horaAbre: d.horaAbre } : {}),
        ...(d.horaFecha !== undefined ? { horaFecha: d.horaFecha } : {}),
        ...(d.diasAbertos !== undefined ? { diasAbertos: d.diasAbertos } : {}),
    };
    // não deixa ligar sem o mínimo para funcionar
    if (dados.ativo === true) {
        // número de restaurante do Sai aê é atendido pelo bot de pedidos: sem consultar o cache, para valer na hora
        limparCacheBarraca(sessionId);
        if (await prisma.barracaSessao.findUnique({ where: { sessionId }, select: { id: true } })) {
            return NextResponse.json({ status: false, message: MSG_SESSAO_DE_BARRACA }, { status: 409 });
        }
        const atual = await prisma.agenteConfig.findUnique({ where: { sessionId } });
        const grupo = dados.grupoRecepcaoJid !== undefined ? dados.grupoRecepcaoJid : atual?.grupoRecepcaoJid;
        const email = dados.emailAviso !== undefined ? dados.emailAviso : atual?.emailAviso;
        const link = dados.linkAgendamento !== undefined ? dados.linkAgendamento : atual?.linkAgendamento;
        if ((!grupo && !email) || !link) return NextResponse.json({ status: false, message: "Para ligar, informe o grupo da recepção ou um e-mail de aviso, e o link (de agendamento ou de cadastro)." }, { status: 400 });
    }
    await prisma.agenteConfig.upsert({ where: { sessionId }, create: { sessionId, ...dados }, update: dados });
    limparCacheConfigAgente(sessionId);
    return NextResponse.json({ status: true });
}
