import { normalizar } from "../alimentar";

/**
 * Trava DETERMINÍSTICA de negociação no vendedor, independente do modelo: pedido de desconto, promoção, cupom ou
 * condição especial NUNCA chega ao modelo; o código chama a equipe e devolve resposta fixa que não concede nem sugere nada.
 */

export const MSG_NEGOCIACAO_AVISADA = "Descontos e condições especiais quem avalia é a nossa equipe. Já avisei a equipe, que fala com você por aqui.";
export const MSG_NEGOCIACAO_SEM_AVISO = "Descontos e condições especiais quem avalia é a nossa equipe, que responde assim que puder. Eu não consigo combinar valores por aqui.";

const NEGOCIACAO = /\b(desconto|descontos|descontinho|promocao|promocoes|promocional|mais barato|mais em conta|barato|negociar|negociacao|abat\w*|condicao especial|condicoes especiais|cupom|cupons|cumpom|cupon|preco especial|valor especial|faz por|fecha por|pagar menos|tem como baixar|baixar o preco|reduzir o preco)\b/;
/** Perguntas sobre o RECURSO de desconto/cupom do produto (para os clientes da loja) seguem para o modelo. */
const PERGUNTA_DO_RECURSO = /\b(clientes?|sistema|aplicativo|app|a loja|funciona|configurar|criar cupom|aplicar)\b/;

export function pedeNegociacao(texto: string | null | undefined): boolean {
    if (typeof texto !== "string" || !texto.trim()) return false;
    const t = normalizar(texto);
    if (!NEGOCIACAO.test(t)) return false;
    return !PERGUNTA_DO_RECURSO.test(t);
}
