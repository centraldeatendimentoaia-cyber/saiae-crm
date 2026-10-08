/**
 * Trava DETERMINÍSTICA de segurança alimentar, independente do modelo. Mensagem de cliente que fala de alergia,
 * intolerância, restrição ou composição NUNCA chega ao modelo: o código chama o responsável e devolve resposta fixa,
 * que jamais garante ausência de alérgeno. Reconhece com e sem acento, maiúsculas e minúsculas, e variações comuns.
 */

export const MSG_ALIMENTAR_AVISADO = "Sobre ingredientes e alergias prefiro confirmar com a loja para ter certeza. Já avisei o responsável, ele fala com você por aqui.";
export const MSG_ALIMENTAR_SEM_AVISO = "Sobre ingredientes e alergias prefiro confirmar com a loja para ter certeza. A loja responde assim que puder. Até lá, por segurança, não consuma o produto sem a confirmação da loja.";

/** Minúsculas, sem acentos, espaços normalizados. */
export function normalizar(texto: string): string {
    return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Termos que SEMPRE indicam saúde/dieta/composição. */
const FORTES = [
    /\balerg\w*/, // alergia, alergico, alergica, alergicos
    /\bintoleran\w*/,
    /\bgluten\b/,
    /\blactose\b/,
    /\bceliac\w*/,
    /\bvegan\w*/,
    /\bvegetarian\w*/,
    /\btrac[oa]s? de\b/, // traço(s) de / traça(s) de (erro comum)
    /\b(pode|posso|podem|podemos|consigo|conseguem) (comer|consumir|ingerir|tomar)\b/,
    /\bingredientes?\b/,
    /\bcomposicao\b/,
    /\b(do que|de que) e (feito|feita)\b/,
    /\bsem (gluten|lactose|leite|ovo|ovos|amendoim|nozes|castanha|castanhas|soja|trigo|acucar|corante|conservante|camarao|peixe|gergelim|frutos do mar|produto de origem animal|origem animal)\b/,
    /\blivre de\b/,
    /\bdiabet\w*/,
    /\bhipertens\w*/,
    /\banafila\w*/,
];

/** Alimentos que são alérgenos mas também são ingredientes de pedido ("com amendoim"): só travam com sinal de dúvida/risco. */
const FRACOS = /\b(amendoim|amendoins|nozes?|castanhas?|ovos?|leite|soja|trigo|camarao|peixe|gergelim|mariscos?|frutos do mar|paçoca|pacoca)\b/;
const SINAL_DE_DUVIDA = /\?|\b(tem|tem algum|contem|conter|leva|levam|feito|feita|misturad\w*|mistura|risco|perigo|passar mal|passa mal|faz mal|cuidado|seguro|segura|certeza)\b/;

export function ehPerguntaAlimentar(texto: string | null | undefined): boolean {
    if (typeof texto !== "string" || !texto.trim()) return false;
    const t = normalizar(texto);
    if (FORTES.some((re) => re.test(t))) return true;
    // "leite ninho", "leite condensado" etc. são adicionais do cardápio, não pergunta de alergia
    const semAdicionais = t.replace(/\bleite (ninho|condensado|em po|moca)\b/g, " ");
    return FRACOS.test(semAdicionais) && SINAL_DE_DUVIDA.test(semAdicionais);
}
