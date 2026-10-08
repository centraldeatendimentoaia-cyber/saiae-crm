import { waManager } from "@/modules/whatsapp/manager";
import { BaileysProvider } from "./baileys";
import type { WhatsAppProvider } from "./types";

export type {
    MediaData,
    MediaKind,
    ProviderCapabilities,
    ProviderName,
    SendMediaInput,
    SendResult,
    WhatsAppProvider,
} from "./types";
export { BaileysProvider } from "./baileys";

/**
 * Provedor de envio da sessão, ou null se ela não está em execução.
 *
 * Hoje sempre devolve o Baileys. Quando a Cloud API oficial existir, a escolha passa a ser por
 * sessão (campo de configuração), sem que nenhum chamador precise mudar.
 */
export function getProvider(sessionId: string): WhatsAppProvider | null {
    const instance = waManager.getInstance(sessionId);
    if (!instance) return null;
    return new BaileysProvider(instance);
}
