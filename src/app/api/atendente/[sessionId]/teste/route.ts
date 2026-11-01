import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardAtendente, type Ctx } from "@/modules/atendente/guard-rota";
import { liberarUso, lerRascunho, obterLlm, PESO_TESTE, simular } from "@/modules/atendente/teste";

const corpo = z.object({
    mensagens: z
        .array(z.object({ papel: z.enum(["cliente", "atendente"]), texto: z.string().trim().min(1).max(2000) }))
        .min(1)
        .max(30)
        .refine((m) => m[m.length - 1].papel === "cliente", "A última mensagem precisa ser do cliente."),
});

/** POST: simula a resposta do RASCUNHO. Não envia nada pelo WhatsApp e não grava nada. */
export async function POST(request: NextRequest, { params }: Ctx) {
    const { sessionId } = await params;
    const g = await guardAtendente(request, sessionId);
    if ("negado" in g) return g.negado;
    const p = corpo.safeParse(await request.json().catch(() => null));
    if (!p.success) return NextResponse.json({ status: false, message: p.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    if (!liberarUso(g.userId, PESO_TESTE)) return NextResponse.json({ status: false, message: "Muitos testes em pouco tempo. Aguarde um minuto." }, { status: 429 });
    const r = await lerRascunho(sessionId);
    if ("erro" in r) return NextResponse.json({ status: false, message: r.mensagem }, { status: r.erro });
    const llm = obterLlm();
    if (!llm) return NextResponse.json({ status: false, message: "A IA não está configurada neste servidor." }, { status: 502 });
    const m = p.data.mensagens;
    const historico = m.slice(0, -1).map((x) => ({ direcao: (x.papel === "cliente" ? "in" : "out") as "in" | "out", texto: x.texto }));
    const s = await simular(llm, r.treino, historico, m[m.length - 1].texto);
    if (s.falhou) return NextResponse.json({ status: false, message: "A atendente não conseguiu responder agora. Tente de novo." }, { status: 502 });
    return NextResponse.json({ status: true, data: { resposta: s.resposta, passouParaPessoa: s.passouParaPessoa, vendaRegistrada: s.vendaRegistrada } });
}
