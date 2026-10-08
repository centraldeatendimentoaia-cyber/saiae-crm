import { DEFAULT_API_VERSION, type CloudApiConfig } from "./client";

/**
 * Credenciais da Cloud API SÓ por variável de ambiente (piloto com 1 número). Nada de token no banco.
 *
 *   META_WA_ACCESS_TOKEN       token de acesso (segredo; definido pelo dono no Railway)
 *   META_WA_PHONE_NUMBER_ID    phone_number_id do número na Meta (não é o telefone)
 *   WHATSAPP_GRAPH_API_VERSION versão da Graph API (padrão v25.0). O dono deve confirmar a versão
 *                              usada pelo app da Meta; versões antigas deixam de funcionar.
 *
 * Devolve null se o token ou o phone_number_id faltarem (Cloud API não configurada).
 */
export function cloudConfigFromEnv(env: Record<string, string | undefined> = process.env): CloudApiConfig | null {
    const accessToken = env.META_WA_ACCESS_TOKEN?.trim();
    const phoneNumberId = env.META_WA_PHONE_NUMBER_ID?.trim();
    if (!accessToken || !phoneNumberId) return null;

    const version = env.WHATSAPP_GRAPH_API_VERSION?.trim();
    return {
        accessToken,
        phoneNumberId,
        // aceita "v25.0" e também "25.0"; formato inválido cai no padrão em vez de montar uma URL quebrada
        apiVersion: version && /^v?\d+\.\d+$/.test(version) ? (version.startsWith("v") ? version : `v${version}`) : DEFAULT_API_VERSION,
    };
}
