/** Tipos do painel de resultados (Sprint 7). Núcleo puro: nada aqui toca banco, rede ou React. */

export const TIPOS_EVENTO = [
    "lead_recebido",
    "conversa_iniciada",
    "resposta",
    "agendamento_solicitado",
    "agendamento_confirmado",
    "comparecimento",
    "venda",
] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

/** Tipos aceitos na importação de agenda: os outros são derivados das mensagens. */
export const TIPOS_IMPORTAVEIS = ["agendamento_solicitado", "agendamento_confirmado", "comparecimento", "venda"] as const;
export type TipoImportavel = (typeof TIPOS_IMPORTAVEIS)[number];

export const ROTULO_TIPO: Record<TipoEvento, string> = {
    lead_recebido: "Leads recebidos",
    conversa_iniciada: "Conversas iniciadas",
    resposta: "Conversas respondidas",
    agendamento_solicitado: "Agendamentos solicitados",
    agendamento_confirmado: "Agendamentos confirmados",
    comparecimento: "Comparecimentos",
    venda: "Vendas",
};

/** Confiança de UM fato. Em um evento, confirma o evento (ex.: a mensagem existe), NÃO a origem: a origem tem a própria confiança (OrigemResolvida.confianca). confirmado = registro direto do WhatsApp ou fonte declarada como conferida; inferido = derivado por regra (a regra vai junto); desconhecido = sem base. */
export type Confianca = "confirmado" | "inferido" | "desconhecido";

export const ORIGENS = ["campanha", "post", "anuncio", "organico", "indicacao", "desconhecido"] as const;
export type Origem = (typeof ORIGENS)[number];

export const ROTULO_ORIGEM: Record<Origem, string> = {
    campanha: "Campanha",
    post: "Post",
    anuncio: "Anúncio",
    organico: "Orgânico",
    indicacao: "Indicação",
    desconhecido: "Origem não identificada",
};

export interface OrigemResolvida {
    origem: Origem;
    confianca: Confianca;
    /** Regra que produziu a origem (sempre presente quando não é "confirmado"). */
    regra: string;
    detalhe?: string;
}

export interface EventoResultado {
    tipo: TipoEvento;
    contato: string;
    quando: Date;
    confianca: Confianca;
    /** Fonte do registro: "mensagem", "venda_ia", "importacao_csv"... */
    fonte: string;
    regra?: string;
    origem: OrigemResolvida;
    valorCentavos?: number | null;
}

export const ROTULO_CONFIANCA_ORIGEM: Record<Confianca, string> = {
    confirmado: "origem confirmada",
    inferido: "origem inferida",
    desconhecido: "origem não identificada",
};
