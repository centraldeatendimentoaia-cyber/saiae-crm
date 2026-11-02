import Anthropic from "@anthropic-ai/sdk";
import { logger as defaultLogger } from "@/lib/logger";

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
    /** Parte estável do prompt (regras, dados da loja): vai com cache_control e é lida do cache nas chamadas seguintes. */
    sistema: string;
    /** Parte que muda a cada mensagem (hora, apresentação, cliente): fica DEPOIS do cache para não invalidá-lo. */
    sistemaVariavel?: string;
    mensagens: MensagemLlm[];
    ferramentas: DefinicaoFerramenta[];
}

/** Tokens de uma chamada (só contagens, nunca conteúdo). */
export interface UsoLlm {
    entrada: number;
    saida: number;
    leituraCache: number;
    criacaoCache: number;
}

export interface SaidaLlm {
    texto?: string;
    chamadas: ChamadaFerramenta[];
    uso?: UsoLlm;
}

export interface Llm {
    responder(entrada: EntradaLlm): Promise<SaidaLlm>;
}

export const TIMEOUT_LLM_MS = 20_000;
export const MAX_TOKENS_RESPOSTA = 1024;
/** Tentativas extras do SDK (com espera crescente) em 429, 5xx, "overloaded" e queda de conexão. */
export const TENTATIVAS_EXTRAS_LLM = 3;

/**
 * Causa de uma falha do modelo para o log, sem conteúdo de cliente: tipo do erro, status HTTP e tipo informado pela API
 * (ex.: "APIError status=404 api=not_found_error" = modelo inexistente; 401 = chave; 400 "credit balance" = sem crédito).
 */
export function descreverErro(e: unknown): string {
    const err = e as { name?: string; status?: number; error?: { error?: { type?: string; message?: string } }; code?: string; cause?: { code?: string } } | null;
    const partes = [err?.name ?? "erro"];
    if (err?.status) partes.push(`status=${err.status}`);
    const api = err?.error?.error;
    if (api?.type) partes.push(`api=${api.type}`);
    // a mensagem da API descreve o problema de configuração (modelo, chave, crédito); nunca traz o texto do cliente
    if (api?.message) partes.push(`msg="${api.message.slice(0, 160)}"`);
    const rede = err?.code ?? err?.cause?.code;
    if (rede) partes.push(`rede=${rede}`);
    return partes.join(" ");
}

/**
 * Implementação com a API da Anthropic. O modelo vem de `IA_MODELO` (sem valor padrão no código: a escolha e o custo são
 * do dono) e a chave de `ANTHROPIC_API_KEY`, definida só no Railway. Timeout de 20 s e novas tentativas com espera (SDK).
 *
 * Não força o uso de ferramenta (`tool_choice: auto`): modelos novos recusam `any`/`tool`. Não usa prefill.
 */
export class LlmAnthropic implements Llm {
    private readonly client: Anthropic;
    private readonly modelo: string;
    private readonly onUso: (u: UsoLlm) => void;

    constructor(opts: { client?: Anthropic; modelo?: string; env?: Record<string, string | undefined>; onUso?: (u: UsoLlm) => void } = {}) {
        const env = opts.env ?? process.env;
        const modelo = (opts.modelo ?? env.IA_MODELO ?? "").trim();
        if (!modelo) throw new Error("IA_MODELO não configurado");
        this.modelo = modelo;
        this.onUso = opts.onUso ?? ((u) => defaultLogger.info("IaLlm", `tokens entrada=${u.entrada} saida=${u.saida} cache_leitura=${u.leituraCache} cache_criacao=${u.criacaoCache}`));
        this.client = opts.client ?? new Anthropic({ timeout: TIMEOUT_LLM_MS, maxRetries: TENTATIVAS_EXTRAS_LLM });
    }

    async responder(entrada: EntradaLlm): Promise<SaidaLlm> {
        const resposta = await this.client.messages.create({
            model: this.modelo,
            max_tokens: MAX_TOKENS_RESPOSTA,
            system: blocosDeSistema(entrada),
            messages: paraAnthropic(entrada.mensagens),
            tools: ferramentasComCache(entrada.ferramentas),
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
        const u = resposta.usage;
        const uso: UsoLlm = { entrada: u?.input_tokens ?? 0, saida: u?.output_tokens ?? 0, leituraCache: u?.cache_read_input_tokens ?? 0, criacaoCache: u?.cache_creation_input_tokens ?? 0 };
        try {
            this.onUso(uso);
        } catch {
            // contagem nunca derruba a resposta
        }
        const texto = textos.join("\n").trim();
        return { texto: texto || undefined, chamadas, uso };
    }
}

/** Prompt de sistema em blocos: o estável com cache_control (cobre também as ferramentas, que vêm antes), o variável depois. */
export function blocosDeSistema(entrada: Pick<EntradaLlm, "sistema" | "sistemaVariavel">): Anthropic.TextBlockParam[] {
    const blocos: Anthropic.TextBlockParam[] = [{ type: "text", text: entrada.sistema, cache_control: { type: "ephemeral" } }];
    if (entrada.sistemaVariavel) blocos.push({ type: "text", text: entrada.sistemaVariavel });
    return blocos;
}

/** Ferramentas com cache_control na última (as definições não mudam entre mensagens). */
export function ferramentasComCache(ferramentas: DefinicaoFerramenta[]): Anthropic.Tool[] {
    return ferramentas.map((f, i) => ({
        name: f.nome,
        description: f.descricao,
        input_schema: f.esquema as Anthropic.Tool.InputSchema,
        ...(i === ferramentas.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));
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
