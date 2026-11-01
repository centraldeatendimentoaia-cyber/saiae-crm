import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { guardAtendente, type Ctx } from "@/modules/atendente/guard-rota";
import { liberarUso, lerRascunho, obterLlm, simular } from "@/modules/atendente/teste";

const corpo = z.object({ jid: z.string().trim().min(3).max(100).regex(/^[^\s@]+@[a-z.]+$/i, "JID inválido") });
const MAX_CHAMADAS = 14;
const MAX_TEXTO = 1000;

/** POST {jid}: o que o RASCUNHO responderia às últimas 14 mensagens recebidas do contato. Não envia nem grava nada. */
export async function POST(request: NextRequest, { params }: Ctx) {
    const { sessionId } = await params;
    const g = await guardAtendente(request, sessionId);
    if ("negado" in g) return g.negado;
    const p = corpo.safeParse(await request.json().catch(() => null));
    if (!p.success) return NextResponse.json({ status: false, message: p.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    if (!liberarUso(g.userId, 5)) return NextResponse.json({ status: false, message: "Muitos testes em pouco tempo. Aguarde um minuto." }, { status: 429 });
    const r = await lerRascunho(sessionId);
    if ("erro" in r) return NextResponse.json({ status: false, message: r.mensagem }, { status: r.erro });
    const llm = obterLlm();
    if (!llm) return NextResponse.json({ status: false, message: "A IA não está configurada neste servidor." }, { status: 502 });
    const sessao = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!sessao) return NextResponse.json({ status: false, message: "Sessão não encontrada" }, { status: 404 });

    const recentes = await prisma.message.findMany({
        where: { sessionId: sessao.id, remoteJid: p.data.jid, content: { not: null } },
        orderBy: { timestamp: "desc" },
        take: 60,
        select: { fromMe: true, content: true },
    });
    const conversa = recentes.reverse().map((m) => ({ direcao: (m.fromMe ? "out" : "in") as "in" | "out", texto: (m.content ?? "").slice(0, MAX_TEXTO) }));
    const indices = conversa.flatMap((m, i) => (m.direcao === "in" ? [i] : [])).slice(-MAX_CHAMADAS);

    const itens: { entrada: string; respostas: string[]; passouParaPessoa: boolean }[] = [];
    for (const i of indices) {
        const s = await simular(llm, r.treino, conversa.slice(Math.max(0, i - 14), i), conversa[i].texto);
        itens.push({ entrada: conversa[i].texto, respostas: s.falhou ? [] : s.resposta, passouParaPessoa: s.passouParaPessoa });
    }
    return NextResponse.json({ status: true, data: itens });
}
