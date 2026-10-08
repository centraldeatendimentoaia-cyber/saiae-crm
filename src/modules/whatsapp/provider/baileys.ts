import { resolveSendJid } from "@/lib/wa-jid";
import type { ProviderCapabilities, SendMediaInput, SendResult, WhatsAppProvider } from "./types";

/** O mínimo que o provedor precisa da instância do Baileys (facilita o teste). */
export interface BaileysInstanceLike {
    sessionId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket: any | null;
}

const CAPABILITIES: ProviderCapabilities = {
    freeTextAnytime: true,
    templates: false,
    groups: true,
    polls: true,
    stickers: true,
};

/**
 * Provedor Baileys: só delega ao socket da instância, com os mesmos payloads que os chamadores
 * montavam à mão. O anti-spam continua no `socket.sendMessage` embrulhado em `instance.ts`.
 */
export class BaileysProvider implements WhatsAppProvider {
    readonly name = "baileys" as const;
    readonly capabilities = CAPABILITIES;

    constructor(private readonly instance: BaileysInstanceLike) {}

    get sessionId(): string {
        return this.instance.sessionId;
    }

    isConnected(): boolean {
        return !!this.instance.socket;
    }

    private get socket() {
        if (!this.instance.socket) throw new Error("Sessão do WhatsApp não está conectada");
        return this.instance.socket;
    }

    async resolveRecipient(to: string): Promise<string> {
        return resolveSendJid(this.socket, to);
    }

    async sendText(to: string, text: string): Promise<SendResult> {
        const result = await this.socket.sendMessage(to, { text });
        return { messageId: result?.key?.id ?? null };
    }

    async sendMedia(to: string, media: SendMediaInput): Promise<SendResult> {
        // Mesmos payloads de antes: cada tipo com os campos que o Baileys espera. Campos ausentes não viram chave.
        let payload: Record<string, unknown>;
        switch (media.kind) {
            case "image":
                payload = { image: media.data };
                if (media.caption !== undefined) payload.caption = media.caption;
                break;
            case "video":
                payload = { video: media.data };
                if (media.caption !== undefined) payload.caption = media.caption;
                break;
            case "audio":
                payload = { audio: media.data };
                break;
            case "document":
                payload = { document: media.data };
                if (media.caption !== undefined) payload.caption = media.caption;
                if (media.mimetype !== undefined) payload.mimetype = media.mimetype;
                if (media.fileName !== undefined) payload.fileName = media.fileName;
                break;
        }
        const result = await this.socket.sendMessage(to, payload);
        return { messageId: result?.key?.id ?? null };
    }
}
