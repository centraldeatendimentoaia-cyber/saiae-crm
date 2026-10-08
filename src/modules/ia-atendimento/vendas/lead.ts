/**
 * Lead da atendente de vendas (tipos e funções puras; o acesso ao banco está em lead-store.ts, para o avaliador não carregar o prisma): um registro por contato (telefone). Guarda só o necessário para a equipe retomar o
 * contato — nome, tipo de negócio, cidade e origem — e NUNCA o texto da conversa. Tudo que vem daqui foi dito pela
 * pessoa (ou escolhido pelo modelo a partir do que ela disse): é dado não confiável, cortado, em uma linha e sem controles.
 */

export type Origem = "panfleto" | "outro";

export interface CamposLead {
    nome?: string;
    negocio?: string;
    cidade?: string;
}

export interface LeadStore {
    /** Cria o lead se ainda não existe (origem pela primeira mensagem) e, se a origem agora é panfleto, atualiza. */
    garantir(contactKey: string, origem: Origem): Promise<void>;
    /** Preenche nome / negócio / cidade (só os campos informados). */
    atualizar(contactKey: string, campos: CamposLead): Promise<void>;
}

/** Texto curto de uma linha: sem controles, sem espaços repetidos, no máximo `max` caracteres. */
export function limparCampo(v: unknown, max = 80): string | undefined {
    if (typeof v !== "string") return undefined;
    const t = v.replace(/[\u0000-\u001F\u007F\u0085\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
    return t || undefined;
}

export const origemDoTexto = (texto: string): Origem => (/panfleto/i.test(texto) ? "panfleto" : "outro");
