/**
 * Interface única de envio do WhatsApp (SAI-003).
 *
 * Hoje a implementação é a do Baileys (biblioteca não oficial). A WhatsApp Cloud API oficial da Meta
 * entra como segunda implementação (ADR-04), escolhida por sessão, sem mudar quem envia mensagens.
 *
 * Regra de ouro desta etapa: introduzir a interface SEM mudar nenhum comportamento. Quem migra para
 * ela chama exatamente o mesmo envio de antes (inclusive o anti-spam, que continua dentro da instância).
 */

export type MediaKind = "image" | "video" | "audio" | "document";

/** Buffer em memória ou URL que o provedor baixa/lê (o formato que o Baileys já aceita). */
export type MediaData = Buffer | { url: string };

export interface SendMediaInput {
    kind: MediaKind;
    data: MediaData;
    /** Legenda. Só existe em imagem, vídeo e documento; áudio ignora. */
    caption?: string;
    mimetype?: string;
    fileName?: string;
}

export interface TemplateInput {
    /** Nome do template aprovado na Meta. */
    name: string;
    /** Idioma do template (ex.: "pt_BR"). */
    languageCode: string;
    /** Valores de {{1}}, {{2}}... do corpo, na ordem. */
    bodyParameters?: string[];
    /** Componentes avançados (cabeçalho com mídia, botões) no formato da Meta, quando preciso. */
    components?: unknown[];
}

export interface SendResult {
    /** ID da mensagem no provedor, quando devolvido. */
    messageId: string | null;
}

export interface ProviderCapabilities {
    /** Pode mandar texto livre a qualquer momento? (Cloud API: só dentro da janela de 24 h.) */
    freeTextAnytime: boolean;
    /** Suporta mensagens de template aprovadas. */
    templates: boolean;
    groups: boolean;
    polls: boolean;
    stickers: boolean;
    /** Mensagem de lista interativa. */
    lists: boolean;
    contacts: boolean;
    locations: boolean;
    reactions: boolean;
    /** Responder citando uma mensagem. */
    replies: boolean;
    forwarding: boolean;
    deleteMessage: boolean;
    editMessage: boolean;
    starMessage: boolean;
    /** Mencionar pessoas em texto de grupo. */
    mentions: boolean;
}

export type Capability = keyof ProviderCapabilities;

export type ProviderName = "baileys" | "cloud-api";

export interface WhatsAppProvider {
    readonly name: ProviderName;
    readonly sessionId: string;
    readonly capabilities: ProviderCapabilities;

    /** A sessão está pronta para enviar? */
    isConnected(): boolean;

    /**
     * Valida e normaliza o destinatário antes de enviar.
     * Baileys: confere no WhatsApp se o número existe e corrige o 9º dígito. Grupos passam direto.
     * Lança erro se o número não tem WhatsApp.
     */
    resolveRecipient(to: string): Promise<string>;

    sendText(to: string, text: string): Promise<SendResult>;
    sendMedia(to: string, media: SendMediaInput): Promise<SendResult>;

    /**
     * Mensagem de template aprovada. Só existe onde `capabilities.templates` é true (Cloud API) e é o
     * único tipo que pode iniciar conversa fora da janela de 24 h.
     */
    sendTemplate?(to: string, template: TemplateInput): Promise<SendResult>;
}
