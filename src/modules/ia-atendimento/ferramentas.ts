import { z } from "zod";
import type { DefinicaoFerramenta } from "./llm";
import type { IaContextoAtivo } from "./comanda-contexto";

/**
 * Ferramentas que o modelo pode pedir. TODAS são seguras por construção: nenhuma lê ou escreve dados do cliente
 * além do que o motor entrega, e nenhuma altera pedido, preço ou cadastro. Os argumentos vêm do modelo (e portanto
 * podem ser influenciados pelo cliente): são validados e limitados aqui, e o link do cardápio sai SEMPRE do contexto
 * da Comanda, nunca do argumento.
 */

export const MOTIVOS_DONO = ["nao_sei", "reclamacao", "assunto_sensivel", "pedido_humano"] as const;
export type MotivoDono = (typeof MOTIVOS_DONO)[number];

export interface AcoesFerramentas {
    /** Avisa o responsável da loja (Task 7). Devolve true se o aviso foi (ou já tinha sido) feito. */
    chamarDono: (motivo: MotivoDono) => Promise<boolean>;
    /** Guarda a pergunta que a IA não soube responder (só contagem/uso interno; nunca em log). */
    registrarPergunta: (pergunta: string) => Promise<void>;
}

export const FERRAMENTAS: DefinicaoFerramenta[] = [
    {
        nome: "enviar_link_cardapio",
        descricao: "Devolve o link do cardápio digital da loja, onde o cliente faz o pedido. Use quando o cliente quiser pedir, ver o cardápio completo ou alterar um pedido.",
        esquema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        nome: "chamar_dono",
        descricao: "Avisa o responsável da loja para assumir a conversa. Use para reclamação, assunto sensível, quando o cliente pedir atendimento humano, ou quando a informação não está nos dados.",
        esquema: {
            type: "object",
            properties: { motivo: { type: "string", enum: [...MOTIVOS_DONO] } },
            required: ["motivo"],
            additionalProperties: false,
        },
    },
    {
        nome: "registrar_pergunta_sem_resposta",
        descricao: "Registra, para o dono da loja, uma pergunta do cliente que você não soube responder com os dados disponíveis.",
        esquema: {
            type: "object",
            properties: { pergunta: { type: "string", maxLength: 300 } },
            required: ["pergunta"],
            additionalProperties: false,
        },
    },
];

const argsDono = z.object({ motivo: z.enum(MOTIVOS_DONO) });
const argsPergunta = z.object({ pergunta: z.string().min(1).transform((s) => s.slice(0, 300)) });

export interface ResultadoFerramenta {
    texto: string;
    erro?: boolean;
    /** true se a ferramenta pediu para pausar a IA nesta conversa (chamar_dono bem-sucedido). */
    chamouDono?: boolean;
}

export async function executarFerramenta(nome: string, argumentos: unknown, ctx: IaContextoAtivo, acoes: AcoesFerramentas): Promise<ResultadoFerramenta> {
    try {
        switch (nome) {
            case "enviar_link_cardapio":
                return { texto: `Link do cardápio: ${ctx.loja.link_cardapio}` };
            case "chamar_dono": {
                const a = argsDono.safeParse(argumentos);
                if (!a.success) return { texto: "motivo inválido", erro: true };
                const ok = await acoes.chamarDono(a.data.motivo);
                return ok
                    ? { texto: "A conversa foi passada ao responsável da loja. Diga ao cliente, em uma frase, que a loja vai responder assim que puder, sem prometer prazo.", chamouDono: true }
                    : { texto: "Não foi possível avisar o responsável agora. Peça desculpas e diga que a loja responderá assim que possível, sem prometer prazo.", erro: true };
            }
            case "registrar_pergunta_sem_resposta": {
                const a = argsPergunta.safeParse(argumentos);
                if (!a.success) return { texto: "pergunta inválida", erro: true };
                await acoes.registrarPergunta(a.data.pergunta);
                return { texto: "registrado" };
            }
            default:
                return { texto: "ferramenta desconhecida", erro: true };
        }
    } catch {
        // nunca propaga nem registra a mensagem do erro (pode conter dado do cliente)
        return { texto: "falha ao executar a ferramenta", erro: true };
    }
}
