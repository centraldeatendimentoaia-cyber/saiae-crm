import { waManager } from "@/modules/whatsapp/manager";
import { cloudConfigFromEnv } from "@/modules/whatsapp/cloud/config";
import { CloudApiProvider } from "@/modules/whatsapp/cloud/provider";
import { ClosedWindowStore } from "@/modules/whatsapp/cloud/window";
import { BaileysProvider } from "./baileys";
import type { WhatsAppProvider } from "./types";

export type {
    Capability,
    MediaData,
    MediaKind,
    ProviderCapabilities,
    ProviderName,
    SendMediaInput,
    SendResult,
    TemplateInput,
    WhatsAppProvider,
} from "./types";
export { BaileysProvider } from "./baileys";

/**
 * Sessões que usam a WhatsApp Cloud API oficial: lista de IDs de sessão separados por vírgula em
 * WHATSAPP_CLOUD_SESSION_ID. Escolha por variável de ambiente (piloto de 1 número, sem mudar o banco).
 * Não conecte o Baileys numa sessão listada aqui: a variável vence e o Baileys deixa de ser usado para enviar.
 */
export function cloudSessionIds(env: Record<string, string | undefined> = process.env): Set<string> {
    return new Set(
        (env.WHATSAPP_CLOUD_SESSION_ID ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
    );
}

/**
 * Janela de 24 h do piloto: ainda não há onde guardar quando o cliente escreveu (sem tabela, de propósito),
 * então texto livre e mídia ficam SEMPRE bloqueados (falha fechada, com WindowClosedError) e só
 * template sai. Troca-se por um WindowStore com banco quando a IA precisar de texto livre.
 */
const pilotWindowStore = new ClosedWindowStore();

/**
 * Provedor de envio da sessão, ou null se ela não está disponível.
 *
 * - Sessão listada em WHATSAPP_CLOUD_SESSION_ID: Cloud API oficial. Sem as credenciais
 *   (META_WA_ACCESS_TOKEN e META_WA_PHONE_NUMBER_ID) devolve null: NUNCA cai para o Baileys em silêncio,
 *   para uma mensagem não sair por outro canal.
 * - Qualquer outra sessão: Baileys, se estiver em execução.
 */
export function getProvider(sessionId: string): WhatsAppProvider | null {
    if (cloudSessionIds().has(sessionId)) {
        const config = cloudConfigFromEnv();
        if (!config) return null;
        return new CloudApiProvider({ sessionId, config, windowStore: pilotWindowStore });
    }
    const instance = waManager.getInstance(sessionId);
    if (!instance) return null;
    return new BaileysProvider(instance);
}
