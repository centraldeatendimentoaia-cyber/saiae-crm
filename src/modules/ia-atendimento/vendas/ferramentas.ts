import { z } from "zod";
import type { DefinicaoFerramenta } from "../llm";
import { limparCampo, type CamposLead } from "./lead";

/**
 * Ferramentas da atendente de vendas. Seguras por construção: o link de cadastro sai SEMPRE da configuração
 * (IA_VENDAS_LINK_CADASTRO), nunca de argumento do modelo; nenhuma ferramenta cobra, cria conta ou altera dado.
 */

export const MOTIVOS_HUMANO = ["pedido_humano", "reclamacao", "fora_do_conhecimento", "negociacao", "feedback_bonus"] as const;
export type MotivoHumano = (typeof MOTIVOS_HUMANO)[number];

export interface AcoesVendas {
    chamarHumano: (motivo: MotivoHumano) => Promise<boolean>;
    /** Link oficial de cadastro/teste, ou null se ainda não configurado. */
    linkCadastro: string | null;
    /** Anota nome / negócio / cidade do interessado. Ausente = ferramenta indisponível. */
    registrarLead?: (campos: CamposLead) => Promise<void>;
}

export const FERRAMENTAS_VENDAS: DefinicaoFerramenta[] = [
    {
        nome: "enviar_link_cadastro",
        descricao: "Devolve o link oficial para a pessoa se cadastrar e começar o teste grátis do Saiaê. Use quando ela quiser testar, assinar ou começar.",
        esquema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        nome: "chamar_humano",
        descricao: "Passa a conversa para uma pessoa da equipe do Saiaê. Use quando a pessoa pedir atendente, reclamar, pedir negociação/desconto/demonstração, ou perguntar algo que não está no conhecimento. Use o motivo feedback_bonus quando alguém do panfleto der feedback do produto ou pedir o bônus de +30 dias: a equipe confirma e libera.",
        esquema: {
            type: "object",
            properties: { motivo: { type: "string", enum: [...MOTIVOS_HUMANO] } },
            required: ["motivo"],
            additionalProperties: false,
        },
    },
];

/** Ferramenta extra, oferecida só quando há onde guardar o lead. */
export const FERRAMENTA_REGISTRAR_LEAD: DefinicaoFerramenta = {
    nome: "registrar_lead",
    descricao: "Anota o interesse da pessoa para a equipe retomar o contato. Use SÓ com o que a pessoa disse espontaneamente: nome, tipo de negócio (ex.: açaiteria, barraca de pastel) e cidade. Nunca peça CPF, CNPJ, e-mail nem dados de pagamento.",
    esquema: {
        type: "object",
        properties: { nome: { type: "string", maxLength: 80 }, negocio: { type: "string", maxLength: 80 }, cidade: { type: "string", maxLength: 80 } },
        additionalProperties: false,
    },
};

const argsLead = z.object({ nome: z.unknown().optional(), negocio: z.unknown().optional(), cidade: z.unknown().optional() });
const argsHumano = z.object({ motivo: z.enum(MOTIVOS_HUMANO) });

export interface ResultadoVendas {
    texto: string;
    erro?: boolean;
}

export async function executarFerramentaVendas(nome: string, argumentos: unknown, acoes: AcoesVendas): Promise<ResultadoVendas> {
    try {
        switch (nome) {
            case "enviar_link_cadastro":
                return acoes.linkCadastro
                    ? { texto: `Link de cadastro e teste grátis: ${acoes.linkCadastro}` }
                    : { texto: "O link de cadastro ainda não está disponível. Diga que uma pessoa vai passar o link e use chamar_humano.", erro: true };
            case "chamar_humano": {
                const a = argsHumano.safeParse(argumentos);
                if (!a.success) return { texto: "motivo inválido", erro: true };
                return (await acoes.chamarHumano(a.data.motivo))
                    ? { texto: "A conversa foi passada para a equipe do Saiaê. Diga à pessoa, em uma frase, que alguém vai responder assim que puder, sem prometer prazo." }
                    : { texto: "Não foi possível avisar a equipe agora. Peça desculpas e diga que a equipe responderá assim que possível, sem prometer prazo.", erro: true };
            }
            case "registrar_lead": {
                if (!acoes.registrarLead) return { texto: "ferramenta desconhecida", erro: true };
                const a = argsLead.safeParse(argumentos);
                if (!a.success) return { texto: "campos inválidos", erro: true };
                const campos: CamposLead = { nome: limparCampo(a.data.nome), negocio: limparCampo(a.data.negocio), cidade: limparCampo(a.data.cidade) };
                if (!campos.nome && !campos.negocio && !campos.cidade) return { texto: "nada para anotar", erro: true };
                await acoes.registrarLead(campos);
                return { texto: "anotado" };
            }
            default:
                return { texto: "ferramenta desconhecida", erro: true };
        }
    } catch {
        return { texto: "falha ao executar a ferramenta", erro: true }; // nunca propaga nem registra a mensagem do erro
    }
}
