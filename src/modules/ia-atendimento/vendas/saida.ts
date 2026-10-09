import { normalizar } from "../alimentar";

/**
 * Trava determinística na SAÍDA do vendedor: se a resposta do modelo PEDIR cartão, CVV, senha, CPF, token, código de
 * verificação ou mandar pagar por chave Pix, ela é trocada por uma frase fixa segura. O vendedor não cobra nem recebe dado
 * de pagamento ou de acesso (o cadastro é feito pela própria pessoa no link oficial).
 */

export const MSG_SAIDA_SEGURA = "Por segurança, eu nunca peço senha, cartão, CPF nem dados de pagamento por aqui. Você faz o cadastro sozinho(a), pelo link oficial, e a nossa equipe ajuda se precisar.";

const DADO = "(cpf|cnpj|cartao|cvv|cvc|codigo de seguranca|senha|token|codigo de verificacao|codigo de confirmacao|chave pix|numero do cartao|dados do cartao|dados de pagamento|dados bancarios|conta bancaria)";
const VERBO_PEDIDO = "(passe|passa|passar|informe|informa|enviar?|envie|manda|mande|mandar|digite|diga|fale|forneca|fornecer|compartilhe|cole|me de|preciso d[oae]s?|precisaremos d[oae]s?|vou precisar d[oae]s?|qual (e )?(o|a|seu|sua)|pode me (passar|enviar|mandar|informar))";
/** Pedido: verbo de pedir/enviar e, logo depois (mesma frase), o dado. */
const PEDE = new RegExp(`\\b${VERBO_PEDIDO}\\b[^.!?\\n]{0,60}\\b${DADO}\\b`);
/** Mandar pagar por chave Pix / transferência / cobrança (o vendedor nunca cobra). */
const COBRA = /\b(pague (agora|aqui|pela|pelo|por|via|no pix|a assinatura|o plano)|transfira|transferir|faca um pix|faca o pix|pix para ativar|pix pra ativar|chave pix[: ]+\S{6,})/;
/** Frase que é negação ou recusa ("nunca peço senha", "não precisa informar CPF"): não conta como pedido. */
const NEGA = /\b(nunca|jamais|nao (peco|pedimos|precisa|precisamos|vou pedir|vamos pedir|envie|passe|informe|compartilhe|mande|digite)|sem precisar|evite|nao envie|nao compartilhe)\b/;

/** true se alguma frase da resposta pede dado sensível ou manda pagar. Frases de negação são ignoradas. */
export function pedeDadoSensivel(resposta: string | null | undefined): boolean {
    if (typeof resposta !== "string" || !resposta.trim()) return false;
    return normalizar(resposta)
        .split(/(?<=[.!?\n])\s+/)
        .some((frase) => !NEGA.test(frase) && (PEDE.test(frase) || COBRA.test(frase)));
}

/** Resposta final do vendedor: a do modelo, ou a frase fixa segura se ela pedir dado sensível / cobrar. */
export function protegerSaida(resposta: string): { texto: string; trocada: boolean } {
    return pedeDadoSensivel(resposta) ? { texto: MSG_SAIDA_SEGURA, trocada: true } : { texto: resposta, trocada: false };
}
