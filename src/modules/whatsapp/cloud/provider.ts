import type {
    ProviderCapabilities,
    SendMediaInput,
    SendResult,
    TemplateInput,
    WhatsAppProvider,
} from "@/modules/whatsapp/provider/types";
import { CloudApiClient, type CloudApiConfig } from "./client";
import { CloudApiError, WindowClosedError } from "./errors";
import { isWindowOpen, type WindowStore } from "./window";

/** Só o que a Cloud API faz hoje no produto: texto, mídia e template. O resto fica no Baileys. */
const CAPABILITIES: ProviderCapabilities = {
    freeTextAnytime: false, // só dentro da janela de 24 h
    templates: true,
    groups: false,
    polls: false,
    stickers: false,
    lists: false,
    contacts: false,
    locations: false,
    reactions: false,
    replies: false,
    forwarding: false,
    deleteMessage: false,
    editMessage: false,
    starMessage: false,
    mentions: false,
};

const MAX_TEXT = 4096;
const MAX_CAPTION = 1024;
const BSUID_RE = /^[A-Za-z]{2}\.[A-Za-z0-9]{1,128}$/;

/** Reconhece o tipo do arquivo pelos primeiros bytes (só os formatos que a Meta aceita e que importam aqui). */
export function sniffMime(b: Buffer): string | null {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if (b.length >= 4 && b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG") return "image/png";
    if (b.length >= 4 && b.toString("latin1", 0, 4) === "%PDF") return "application/pdf";
    if (b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp") return "video/mp4";
    if (b.length >= 4 && b.toString("latin1", 0, 4) === "OggS") return "audio/ogg";
    return null;
}

export interface CloudApiProviderOptions {
    sessionId: string;
    config: CloudApiConfig;
    windowStore: WindowStore;
    now?: () => Date;
}

/**
 * Provedor da WhatsApp Cloud API oficial. Só envia; a entrada vem pelo webhook (ver ./inbound.ts).
 * Não chama a Meta quando já sabe que o envio seria recusado (janela fechada, texto inválido).
 */
export class CloudApiProvider implements WhatsAppProvider {
    readonly name = "cloud-api" as const;
    readonly capabilities = CAPABILITIES;
    readonly sessionId: string;

    private readonly client: CloudApiClient;
    private readonly windowStore: WindowStore;
    private readonly now: () => Date;

    constructor(opts: CloudApiProviderOptions) {
        this.sessionId = opts.sessionId;
        this.client = new CloudApiClient(opts.config);
        this.windowStore = opts.windowStore;
        this.now = opts.now ?? (() => new Date());
    }

    /** Não há conexão persistente: "conectado" = configurado. */
    isConnected(): boolean {
        return true;
    }

    /** Normaliza para só dígitos (sem consultar a Meta). Rejeita grupo e destinatário inválido. */
    async resolveRecipient(to: string): Promise<string> {
        return this.normalize(to);
    }

    async sendText(to: string, text: string): Promise<SendResult> {
        if (typeof text !== "string" || text.trim() === "") throw new CloudApiError("invalid_request", "Texto vazio: a Cloud API não envia mensagem sem texto");
        if (text.length > MAX_TEXT) throw new CloudApiError("invalid_request", `Texto longo demais (${text.length} > ${MAX_TEXT} caracteres)`);
        const recipient = this.normalize(to);
        await this.assertWindowOpen(recipient);
        const id = await this.client.sendMessage({
            recipient_type: "individual",
            to: recipient,
            type: "text",
            text: { body: text, preview_url: false },
        });
        return { messageId: id };
    }

    async sendMedia(to: string, media: SendMediaInput): Promise<SendResult> {
        if (media.caption !== undefined && media.kind !== "audio" && media.caption.length > MAX_CAPTION) {
            throw new CloudApiError("invalid_request", `Legenda longa demais (${media.caption.length} > ${MAX_CAPTION} caracteres)`);
        }
        const recipient = this.normalize(to);
        await this.assertWindowOpen(recipient);

        const source = await this.mediaSource(media);
        const body: Record<string, unknown> = { ...source };
        if (media.kind !== "audio" && media.caption) body.caption = media.caption;
        if (media.kind === "document" && media.fileName) body.filename = media.fileName;

        const id = await this.client.sendMessage({
            recipient_type: "individual",
            to: recipient,
            type: media.kind,
            [media.kind]: body,
        });
        return { messageId: id };
    }

    /** Template aprovado: o único envio permitido fora da janela de 24 h. */
    async sendTemplate(to: string, template: TemplateInput): Promise<SendResult> {
        if (!template.name?.trim()) throw new CloudApiError("invalid_request", "Nome do template é obrigatório");
        if (!template.languageCode?.trim()) throw new CloudApiError("invalid_request", "Idioma do template é obrigatório (ex.: pt_BR)");
        const recipient = this.normalize(to);

        const components: unknown[] = [...(template.components ?? [])];
        if (template.bodyParameters?.length) {
            if (template.bodyParameters.some((p) => typeof p !== "string")) throw new CloudApiError("invalid_request", "Parâmetros do template devem ser texto");
            components.unshift({ type: "body", parameters: template.bodyParameters.map((text) => ({ type: "text", text })) });
        }

        if (template.buttonParameters?.length) {
            if (template.buttonParameters.some((p) => typeof p !== "string" || p === "")) throw new CloudApiError("invalid_request", "Parâmetros do botão devem ser texto não vazio");
            components.push({ type: "button", sub_type: "url", index: "0", parameters: template.buttonParameters.map((text) => ({ type: "text", text })) });
        }

        const id = await this.client.sendMessage({
            recipient_type: "individual",
            to: recipient,
            type: "template",
            template: {
                name: template.name,
                language: { code: template.languageCode },
                ...(components.length ? { components } : {}),
            },
        });
        return { messageId: id };
    }

    // ------------------------------------------------------------------ internos

    private normalize(to: string): string {
        const raw = String(to ?? "").trim();
        if (raw.endsWith("@g.us") || (raw.includes("@") && !raw.endsWith("@s.whatsapp.net"))) {
            throw new CloudApiError("unsupported", "A Cloud API não envia para grupos nem canais");
        }
        const id = raw.replace(/@s\.whatsapp\.net$/, "").split(":")[0];
        if (BSUID_RE.test(id)) {
            throw new CloudApiError("unsupported", "Envio para cliente identificado só por BSUID (telefone oculto) ainda não está implementado");
        }
        const digits = id.replace(/\D/g, "");
        if (digits.length < 8 || digits.length > 15) throw new CloudApiError("invalid_request", "Número de destino inválido");
        return digits;
    }

    private async assertWindowOpen(recipient: string): Promise<void> {
        const last = await this.windowStore.lastInboundAt(this.sessionId, recipient);
        if (!isWindowOpen(last, this.now())) throw new WindowClosedError(last);
    }

    private async mediaSource(media: SendMediaInput): Promise<Record<string, unknown>> {
        const data = media.data;
        if (Buffer.isBuffer(data)) {
            const mime = media.mimetype ?? sniffMime(data) ?? (media.kind === "document" ? "application/octet-stream" : null);
            if (!mime) throw new CloudApiError("invalid_request", "Não foi possível identificar o tipo do arquivo: informe o mimetype");
            const id = await this.client.uploadMedia(data, mime, media.fileName ?? "arquivo");
            return { id };
        }
        if (!data?.url || !/^https:\/\//i.test(data.url)) {
            throw new CloudApiError("invalid_request", "A Cloud API só aceita mídia por link HTTPS público ou por arquivo enviado");
        }
        return { link: data.url };
    }
}
