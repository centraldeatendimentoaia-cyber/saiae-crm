import type { Origem, OrigemResolvida } from "./tipos";

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Classifica o NOME de uma etiqueta de origem (ex.: "Origem: Meta", "Google", "Indicação"). Etiqueta de interesse ou
 * status (ex.: "Corte", "Sumiu - follow up") devolve null.
 */
export function origemDaEtiqueta(nome: string): Origem | null {
    const n = semAcento(nome);
    if (/indica/.test(n)) return "indicacao";
    if (/organic/.test(n)) return "organico";
    if (/\b(post|story|stories|reel|reels)\b/.test(n)) return "post";
    if (/\b(anuncio|ads?|trafego)\b|meta|facebook/.test(n)) return "anuncio";
    if (/google|campanha|origem/.test(n)) return "campanha";
    return null;
}

export interface FontesOrigem {
    /** Origem declarada em planilha importada (ResultEvent.origem), se houver. */
    importada?: { origem: Origem; detalhe?: string | null };
    /** ConversaOrigem: "anuncio" quando a 1ª mensagem trouxe marcador de clique-para-WhatsApp; "organico" sem marcador. */
    conversaOrigem?: "anuncio" | "organico";
    /** Nomes das etiquetas do contato. */
    etiquetas?: string[];
}

/**
 * Regra de origem, por prioridade. NUNCA afirma qual campanha causou a venda: só diz de onde o contato aparentemente veio.
 *  1. Marcador de anúncio na 1ª mensagem (externalAdReply/conversionSource): anúncio, CONFIRMADO (o marcador é registro do WhatsApp; a campanha específica segue desconhecida).
 *  2. Origem declarada em planilha importada: INFERIDO (declaração do usuário, não verificada pelo CRM).
 *  3. Etiqueta de origem aplicada ao contato: INFERIDO (etiqueta é humana ou automática, sem prova).
 *  4. ConversaOrigem = "organico": INFERIDO (regra: ausência de marcador de anúncio; pode ser indicação, post ou anúncio sem rastreio).
 *  5. Nada disso: DESCONHECIDO ("origem não identificada").
 */
export function resolverOrigem(f: FontesOrigem): OrigemResolvida {
    if (f.conversaOrigem === "anuncio") return { origem: "anuncio", confianca: "confirmado", regra: "marcador de anúncio (clique para WhatsApp) na primeira mensagem" };
    if (f.importada) {
        return { origem: f.importada.origem, confianca: "inferido", regra: "origem informada na planilha importada", detalhe: f.importada.detalhe ?? undefined };
    }
    for (const nome of f.etiquetas ?? []) {
        const o = origemDaEtiqueta(nome);
        if (o) return { origem: o, confianca: "inferido", regra: `etiqueta de origem "${nome}"` };
    }
    if (f.conversaOrigem === "organico") return { origem: "organico", confianca: "inferido", regra: "sem marcador de anúncio na primeira mensagem" };
    return { origem: "desconhecido", confianca: "desconhecido", regra: "nenhum marcador, etiqueta ou planilha informa a origem" };
}
