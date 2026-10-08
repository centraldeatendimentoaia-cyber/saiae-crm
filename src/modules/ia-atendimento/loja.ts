/**
 * Código da loja no link/QR do cliente (`wa.me/<número>?text=...#K7P2QX`). É o `ia_codigo` da Comanda:
 * 6 caracteres de um alfabeto sem ambiguidade (sem 0, O, 1, I, L). O código é só um identificador público
 * da loja; ele NÃO autentica nada (a Comanda decide se a IA da loja está ligada).
 */
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODIGO = new RegExp(`#([${ALFABETO}]{6})(?![A-Za-z0-9])`, "i");

/** Aceita `#K7P2QX` em qualquer posição do texto, em maiúsculas ou minúsculas. Devolve em maiúsculas, ou null. */
export function extrairCodigoLoja(texto: string | null | undefined): string | null {
    if (typeof texto !== "string") return null;
    const m = CODIGO.exec(texto);
    return m ? m[1].toUpperCase() : null;
}

export const ehCodigoLojaValido = (codigo: string): boolean => new RegExp(`^[${ALFABETO}]{6}$`).test(codigo);
