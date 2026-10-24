/**
 * Confirmação explícita do cliente. Regra de segurança do bot: o pedido só sai depois de um "sim" claro, verificado aqui
 * em código (nunca pelo modelo). Texto com qualquer palavra fora da lista ("sim mas troca o molho") não vale.
 */

export const normalizar = (texto: string): string =>
    texto
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

const AFIRMATIVOS = new Set([
    "sim", "s", "ss", "simm", "pode", "pode sim", "pode ser", "sim pode", "pode confirmar", "confirmo", "confirmado", "confirma",
    "sim confirmo", "isso", "isso mesmo", "isso ai", "ok", "okay", "beleza", "blz", "fechado", "fechou", "claro", "com certeza",
    "positivo", "uhum", "aham", "sim por favor", "pode mandar", "pode anotar", "manda ver",
]);

export function isAfirmativo(texto: string): boolean {
    const t = normalizar(texto.replace(/[\u{1F44D}\u{1F44C}\u{2705}]/gu, " sim "));
    return t.length > 0 && t.length <= 30 && AFIRMATIVOS.has(t);
}

const SAUDACOES = new Set(["oi", "oie", "oii", "ola","eai", "e ai", "opa", "bom dia", "boa tarde", "boa noite", "oi bom dia", "oi boa tarde", "oi boa noite", "ola bom dia", "ola boa tarde", "ola boa noite", "hello", "hi"]);

/** Só uma saudação, sem pedido nenhum. */
export function isSaudacao(texto: string): boolean {
    return SAUDACOES.has(normalizar(texto));
}

/** Escolha de pagamento do cliente ao resumo: SIM = pagar na retirada, PIX = pagar agora; null = não confirmou. */
export function escolhaDeConfirmacao(texto: string, pagamentos: { na_entrega: boolean; pix: boolean }): "na_entrega" | "pix" | null {
    if (normalizar(texto) === "pix") return pagamentos.pix ? "pix" : null;
    if (!isAfirmativo(texto)) return null;
    if (pagamentos.na_entrega) return "na_entrega";
    return pagamentos.pix ? "pix" : null;
}
