import Anthropic from "@anthropic-ai/sdk";

/**
 * Fronteira com o modelo de linguagem. O motor só conhece esta interface; os testes usam um LLM falso e a
 * produção usa `LlmAnthropic`. Mensagens do histórico, pedidos de ferramenta e resultados de ferramenta são
 * mantidos em um formato próprio, simples, e traduzidos para o protocolo da Anthropic só aqui.
 */

export interface DefinicaoFerramenta {
    nome: string;
    descricao: string;
    /** JSON Schema do objeto de argumentos. */
    esquema: Record<string, unknown>;
}

export interface ChamadaFerramenta {
    id: string;
    nome: string;
    argumentos: unknown;
}

export type MensagemLlm =
    | { papel: "user" | "assistant"; texto: string }
    | { papel: "assistant"; texto?: string; chamadas: ChamadaFerramenta[] }
    | { papel: "tool"; resultados: { id: string; texto: string; erro?: boolean }[] };

export interface EntradaLlm {
    sistema: string;
    mensagens: MensagemLlm[];
    ferramentas: DefinicaoFerramenta[];
}

export interface SaidaLlm {
    texto?: string;
    chamadas: ChamadaFerramenta[];
}

export interface Llm {
    responder(entrada: EntradaLlm): Promise<SaidaLlm>;
}

export const TIMEOUT_LLM_MS = 20_000;
export const MAX_TOKENS_RESPOSTA = 1024;

/**
 * Implementação com a API da Anthropic. O modelo vem de `IA_MODELO` (sem valor padrão no código: a escolha e o custo são
 * do dono) e a chave de `ANTHROPIC_API_KEY`, definida só no Railway. Timeout de 20 s e uma nova tentativa (SDK).
 *
 * Não força o uso de ferramenta (`tool_choice: auto`): modelos novos recusam `any`/`tool`. Não usa prefill.
 */
export class LlmAnthropic implements Llm {
    private readonly client: Anthropic;
    private readonly modelo: string;

    constructor(opts: { client?: Anthropic; modelo?: string; env?: Record<string, string | undefined> } = {}) {
        const env = opts.env ?? process.env;
        const modelo = (opts.modelo ?? env.IA_MODELO ?? "").trim();
        if (!modelo) throw new Error("IA_MODELO não configurado");
        this.modelo = modelo;
        this.client = opts.client ?? new Anthropic({ timeout: TIMEOUT_LLM_MS, maxRetries: 1 });
    }

    async responder(entrada: EntradaLlm): Promise<SaidaLlm> {
        const resposta = await this.client.messages.create({
            model: this.modelo,
            max_tokens: MAX_TOKENS_RESPOSTA,
            system: entrada.sistema,
            messages: paraAnthropic(entrada.mensagens),
            tools: entrada.ferramentas.map((f) => ({ name: f.nome, description: f.descricao, input_schema: f.esquema as Anthropic.Tool.InputSchema })),
            tool_choice: { type: "auto" },
        });

        const textos: string[] = [];
        const chamadas: ChamadaFerramenta[] = [];
        for (const bloco of resposta.content) {
            if (bloco.type === "text") textos.push(bloco.text);
            else if (bloco.type === "tool_use") chamadas.push({ id: bloco.id, nome: bloco.name, argumentos: bloco.input });
        }
        // recusa por segurança do modelo: nada de texto nem ferramenta; o motor responde com a mensagem segura
        if (resposta.stop_reason === "refusal") return { chamadas: [] };
        const texto = textos.join("\n").trim();
        return { texto: texto || undefined, chamadas };
    }
}

export function paraAnthropic(mensagens: MensagemLlm[]): Anthropic.MessageParam[] {
    return mensagens.map((m): Anthropic.MessageParam => {
        if (m.papel === "tool") {
            return {
                role: "user",
                content: m.resultados.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.texto, ...(r.erro ? { is_error: true } : {}) })),
            };
        }
        if ("chamadas" in m) {
            const blocos: Anthropic.ContentBlockParam[] = [];
            if (m.texto) blocos.push({ type: "text", text: m.texto });
            for (const c of m.chamadas) blocos.push({ type: "tool_use", id: c.id, name: c.nome, input: (c.argumentos ?? {}) as Record<string, unknown> });
            return { role: "assistant", content: blocos };
        }
        return { role: m.papel, content: m.texto };
    });
}
