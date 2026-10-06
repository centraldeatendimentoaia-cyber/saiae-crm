import { NextResponse, NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/api-auth";

const bodySchema = z.object({
    objective: z.string().min(3).max(1000),
    tone: z.string().max(100).optional(),
    variations: z.number().int().min(1).max(5).optional(),
});

const SYSTEM_PROMPT = `Você é redator(a) de pequenos negócios brasileiros (salões, barracas, lanchonetes e lojas).
Escreva mensagens de WhatsApp em português do Brasil, com tom elegante, acolhedor e direto.
Regras: mensagens curtas (até 450 caracteres), no máximo 2 emojis discretos, sem exageros de promoção,
sem parecer spam, com uma chamada para ação clara (ex.: responder para agendar). Use a formatação do
WhatsApp apenas quando ajudar (*negrito*). Não invente preços, datas ou condições que não foram informados.
Quando fizer sentido, cumprimente usando a variável {primeironome} exatamente assim (o sistema troca pelo primeiro nome do cliente). Exemplo: "Oi, {primeironome}!".
Responda SOMENTE com um array JSON de strings, uma por variação, sem texto fora do JSON.`;

export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ status: false, error: "Unauthorized" }, { status: 401 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return NextResponse.json(
            { status: false, error: "Chave GEMINI_API_KEY não configurada no servidor." },
            { status: 503 }
        );
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
        return NextResponse.json({ status: false, error: "Descreva o objetivo da mensagem." }, { status: 400 });
    }
    const { objective, tone, variations = 3 } = parsed.data;
    const primary = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    // Se o modelo principal estiver sobrecarregado, tenta modelos leves como reserva
    const models = [...new Set([primary, "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"])];

    try {
        let res!: Response;
        outer: for (const model of models) {
            for (let attempt = 0; attempt < 2; attempt++) {
                res = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
                        body: JSON.stringify({
                            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                            contents: [{
                                role: "user",
                                parts: [{ text: `Crie ${variations} variações de mensagem.
Objetivo: ${objective}
Tom: ${tone || "elegante e acolhedor"}` }],
                            }],
                            generationConfig: { responseMimeType: "application/json", temperature: 0.9 },
                        }),
                        signal: AbortSignal.timeout(25000),
                    }
                ).catch((): Response => new Response(null, { status: 503 }));
                if (res.ok) break outer;
                if (![429, 500, 503, 404].includes(res.status)) break outer;
                if (res.status === 404) break; // modelo indisponível: vai para o próximo
                await new Promise((r) => setTimeout(r, 800));
            }
        }
        if (!res.ok) {
            const detail = await res.text();
            console.error("Gemini error", res.status, detail.slice(0, 300));
            const msg = res.status === 429
                ? "Limite gratuito do Gemini atingido. Tente novamente em instantes."
                : "Falha ao gerar o texto com a IA.";
            return NextResponse.json({ status: false, error: msg }, { status: 502 });
        }
        const data = await res.json();
        const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
        let list: unknown;
        try { list = JSON.parse(text); } catch { list = [text]; }
        const copies = (Array.isArray(list) ? list : [list]).filter(
            (x): x is string => typeof x === "string" && x.trim().length > 0
        );
        return NextResponse.json({ status: true, copies });
    } catch (e) {
        console.error("AI copy error", e);
        return NextResponse.json({ status: false, error: "Erro ao conectar com a IA." }, { status: 500 });
    }
}
