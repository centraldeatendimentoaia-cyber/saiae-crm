import { z } from "zod";

/**
 * Treino da atendente: tudo o que o dono escreve e que, mais tarde, entra no prompt da IA. Este schema é a fronteira de
 * confiança: apara espaços, normaliza quebras de linha e rejeita caracteres de controle (exceto \n e \t).
 * Limites de tamanho por campo existem para o prompt não crescer sem controle.
 */

export const LIMITE_BASE_TOTAL = 40_000; // soma dos textos da base de conhecimento
export const LIMITE_OBJECOES = 30;
export const LIMITE_EXEMPLOS = 30;
// O brief fala em 12 gatilhos "extras"; os 6 gatilhos padrão são à parte, então o teto do array é 6 + 12 = 18.
export const LIMITE_GATILHOS = 18;

// Controle C0/C1 (menos \n e \t), largura zero, marcas bidi, separadores de linha/parágrafo e BOM: nada disso é texto
// legítimo do dono, e todos servem para esconder instruções dentro do prompt.
const CONTROLE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/;

/** String aparada, com \r\n virando \n, tamanho entre min e max e sem caracteres de controle. */
const texto = (max: number, min = 0) =>
    z
        .string()
        .transform((s) => s.replace(/\r\n?/g, "\n").trim())
        .pipe(
            z
                .string()
                .min(min)
                .max(max)
                .refine((s) => !CONTROLE.test(s), "caractere de controle não permitido"),
        );

const NOME = 200; // nomes e títulos curtos
const FRASE = 2000; // instruções, respostas e textos corridos
const HTTPS = /^https:\/\/\S+$/i;

const hostValido = (s: string) => {
    try {
        const u = new URL(s);
        const h = u.hostname;
        return u.protocol === "https:" && !u.username && !u.password && h.includes(".") && !h.startsWith(".") && !h.endsWith(".");
    } catch {
        return false;
    }
};
const Link = texto(2000, 1)
    .refine((s) => HTTPS.test(s), "o link precisa começar com https://")
    .refine(hostValido, "o link precisa ser um endereço https válido, sem usuário e senha");

export const TreinoSchema = z
    .object({
        identidade: z.object({
            nome: texto(NOME, 1),
            negocio: texto(NOME, 1),
            tom: texto(FRASE),
        }),
        base: z
            .array(
                z.object({
                    titulo: texto(NOME, 1),
                    texto: texto(LIMITE_BASE_TOTAL),
                    atualizadoEm: texto(40),
                }),
            )
            .max(200),
        roteiro: z.object({
            etapas: z.array(z.object({ nome: texto(NOME, 1), instrucao: texto(FRASE) })).max(20),
            desfecho: z
                .object({ tipo: z.enum(["link", "pessoa"]), link: Link.optional() })
                .refine((d) => d.tipo !== "link" || !!d.link, { message: "informe o link do desfecho", path: ["link"] }),
        }),
        gatilhos: z
            .array(
                z.object({
                    id: z.string().regex(/^[a-z0-9_-]{1,64}$/i),
                    ativo: z.boolean(),
                    descricao: texto(FRASE, 1),
                    frase: texto(FRASE),
                }),
            )
            .max(LIMITE_GATILHOS),
        objecoes: z
            .array(z.object({ cliente: texto(FRASE, 1), resposta: texto(FRASE), proximoPasso: texto(FRASE) }))
            .max(LIMITE_OBJECOES),
        exemplos: z
            .array(z.object({ cliente: texto(FRASE, 1), ideal: texto(FRASE, 1), evitar: texto(FRASE).optional() }))
            .max(LIMITE_EXEMPLOS),
        followUp: z.object({
            maxMensagens: z.number().int().min(0).max(5),
            intervaloHoras: z.number().int().min(1).max(720),
            textos: z.array(texto(FRASE, 1)).max(10),
        }),
        vocabulario: z.object({ cliente: texto(100, 1), clientes: texto(100, 1) }),
    })
    .superRefine((t, ctx) => {
        const vistos = new Set<string>();
        t.gatilhos.forEach((g, i) => {
            if (vistos.has(g.id)) ctx.addIssue({ code: "custom", path: ["gatilhos", i, "id"], message: `id de gatilho repetido: ${g.id}` });
            vistos.add(g.id);
            // A frase é a mensagem que o motor envia ao passar para uma pessoa; gatilho ligado sem ela deixaria o cliente sem resposta.
            if (g.ativo && !g.frase) ctx.addIssue({ code: "custom", path: ["gatilhos", i, "frase"], message: "gatilho ativo precisa ter a frase de transferência" });
        });
        const total = t.base.reduce((soma, b) => soma + b.texto.length, 0);
        if (total > LIMITE_BASE_TOTAL) {
            ctx.addIssue({ code: "custom", path: ["base"], message: `a base passa de ${LIMITE_BASE_TOTAL} caracteres no total` });
        }
    });

export type Treino = z.infer<typeof TreinoSchema>;
