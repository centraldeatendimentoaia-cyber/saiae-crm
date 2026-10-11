import { logger } from "@/lib/logger";

/**
 * Transcrição de áudio (nota de voz do WhatsApp) com o Gemini, para a IA "ouvir". A chave é a mesma GEMINI_API_KEY do
 * gerador de textos do CRM. O áudio vive só na memória (nunca é gravado) e nenhum conteúdo vai para o log.
 * Qualquer falha devolve null: quem chama volta ao comportamento seguro (avisar que não ouve e chamar uma pessoa).
 */

export const MAX_SEGUNDOS_AUDIO = 90;
export const MAX_BYTES_AUDIO = 2_500_000;
const TAG = "AgenteAudio";

const PROMPT = "Transcreva fielmente, em português do Brasil, o áudio a seguir (uma mensagem de voz de WhatsApp enviada por um cliente a uma empresa). Responda SOMENTE com a transcrição, sem comentários, sem aspas e sem rótulos. Se não houver fala compreensível, responda exatamente: [inaudível]";

/** WhatsApp entrega "audio/ogg; codecs=opus": o Gemini quer só "audio/ogg". */
export function mimeDoAudio(mime: string | null | undefined): string {
    const m = (mime ?? "audio/ogg").split(";")[0].trim().toLowerCase();
    return m === "audio/mpeg" || m === "audio/mp3" || m === "audio/aac" || m === "audio/mp4" || m === "audio/wav" || m === "audio/flac" ? m : "audio/ogg";
}

export interface DepsTranscricao {
    env?: Record<string, string | undefined>;
    fetchFn?: typeof fetch;
}

export async function transcreverComGemini(audio: Buffer, mime: string | null | undefined, deps: DepsTranscricao = {}): Promise<string | null> {
    const env = deps.env ?? process.env;
    const doFetch = deps.fetchFn ?? fetch;
    const apiKey = env.GEMINI_API_KEY?.trim();
    if (!apiKey || audio.length === 0 || audio.length > MAX_BYTES_AUDIO) return null;

    const primario = env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
    const modelos = [...new Set([primario, "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"])];
    const corpo = JSON.stringify({
        contents: [{ role: "user", parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeDoAudio(mime), data: audio.toString("base64") } }] }],
        generationConfig: { temperature: 0 },
    });

    for (const modelo of modelos) {
        try {
            const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
                body: corpo,
                signal: AbortSignal.timeout(25_000),
            });
            if (res.status === 404 || res.status === 429 || res.status === 500 || res.status === 503) continue; // tenta o próximo modelo
            if (!res.ok) {
                logger.warn(TAG, `Gemini recusou a transcrição (HTTP ${res.status})`);
                return null;
            }
            const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
            const texto = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").replace(/\s+/g, " ").trim();
            if (!texto || /^\[?inaudível\]?\.?$/i.test(texto)) return null;
            return texto.slice(0, 1200);
        } catch (e) {
            logger.warn(TAG, `falha na transcrição: ${(e as { name?: string })?.name ?? "erro"}`);
        }
    }
    return null;
}
