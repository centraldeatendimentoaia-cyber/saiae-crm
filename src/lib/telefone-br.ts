/**
 * Transforma o que a pessoa digitou (ex.: "(61) 99999-0000", "061999990000") em dígitos com o DDI do Brasil.
 * Número com 10 ou 11 dígitos (DDD + telefone) ganha o 55; os demais seguem como foram digitados (já têm DDI).
 */
export function telefoneComDdi(digitado: string): string {
    const digitos = digitado.replace(/\D/g, "").replace(/^0+/, "");
    return digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
}

/** JID de conversa individual a partir do que foi digitado. */
export function jidDoTelefone(digitado: string): string {
    return `${telefoneComDdi(digitado)}@s.whatsapp.net`;
}
