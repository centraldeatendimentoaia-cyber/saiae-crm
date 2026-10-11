import { describe, expect, it, vi } from "vitest";
import { MAX_BYTES_AUDIO, mimeDoAudio, transcreverComGemini } from "./transcricao";

const env = { GEMINI_API_KEY: "chave-falsa", GEMINI_MODEL: "gemini-3.5-flash-lite" };
const audio = Buffer.from("audio-falso");
const resposta = (texto: string, status = 200) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: texto }] } }] }), { status });

describe("transcreverComGemini", () => {
    it("envia o áudio em base64 com o tipo certo e devolve a transcrição limpa", async () => {
        const fetchFn = vi.fn(async () => resposta("  Oi, queria saber o preço\n do corte  "));
        const t = await transcreverComGemini(audio, "audio/ogg; codecs=opus", { env, fetchFn: fetchFn as never });
        expect(t).toBe("Oi, queria saber o preço do corte");
        const chamada = fetchFn.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
        expect(chamada[0]).toContain("gemini-3.5-flash-lite:generateContent");
        expect(chamada[1].headers["x-goog-api-key"]).toBe("chave-falsa");
        const corpo = JSON.parse(chamada[1].body);
        expect(corpo.contents[0].parts[1].inline_data).toEqual({ mime_type: "audio/ogg", data: audio.toString("base64") });
    });
    it("sem chave, áudio vazio ou grande demais: null, sem chamar a rede", async () => {
        const fetchFn = vi.fn();
        expect(await transcreverComGemini(audio, "audio/ogg", { env: {}, fetchFn: fetchFn as never })).toBeNull();
        expect(await transcreverComGemini(Buffer.alloc(0), "audio/ogg", { env, fetchFn: fetchFn as never })).toBeNull();
        expect(await transcreverComGemini(Buffer.alloc(MAX_BYTES_AUDIO + 1), "audio/ogg", { env, fetchFn: fetchFn as never })).toBeNull();
        expect(fetchFn).not.toHaveBeenCalled();
    });
    it("inaudível vira null", async () => {
        expect(await transcreverComGemini(audio, "audio/ogg", { env, fetchFn: (async () => resposta("[inaudível]")) as never })).toBeNull();
        expect(await transcreverComGemini(audio, "audio/ogg", { env, fetchFn: (async () => resposta("   ")) as never })).toBeNull();
    });
    it("modelo sobrecarregado ou inexistente: tenta o próximo", async () => {
        const fetchFn = vi.fn()
            .mockResolvedValueOnce(new Response("{}", { status: 503 }))
            .mockResolvedValueOnce(resposta("quero agendar"));
        const t = await transcreverComGemini(audio, "audio/ogg", { env: { ...env, GEMINI_MODEL: "gemini-3.8-flash" }, fetchFn: fetchFn as never });
        expect(t).toBe("quero agendar");
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });
    it("recusa definitiva (ex.: 400) ou erro de rede: null", async () => {
        expect(await transcreverComGemini(audio, "audio/ogg", { env, fetchFn: (async () => new Response("{}", { status: 400 })) as never })).toBeNull();
        expect(await transcreverComGemini(audio, "audio/ogg", { env: { GEMINI_API_KEY: "k", GEMINI_MODEL: "m" }, fetchFn: (async () => { throw new Error("rede"); }) as never })).toBeNull();
    });
    it("limita o tamanho da transcrição", async () => {
        const t = await transcreverComGemini(audio, "audio/ogg", { env, fetchFn: (async () => resposta("a".repeat(5000))) as never });
        expect(t).toHaveLength(1200);
    });
});

describe("mimeDoAudio", () => {
    it("normaliza o tipo do WhatsApp", () => {
        expect(mimeDoAudio("audio/ogg; codecs=opus")).toBe("audio/ogg");
        expect(mimeDoAudio("audio/mpeg")).toBe("audio/mpeg");
        expect(mimeDoAudio(undefined)).toBe("audio/ogg");
        expect(mimeDoAudio("application/x")).toBe("audio/ogg");
    });
});
