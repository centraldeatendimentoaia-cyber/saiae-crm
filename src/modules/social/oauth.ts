import { createHmac, timingSafeEqual } from "crypto";
import { GRAPH_VERSION } from "./graph";

/**
 * Login com a Meta (OAuth) para conectar Páginas e Instagram sem colar token.
 * Variáveis: SOCIAL_META_APP_ID e SOCIAL_META_APP_SECRET (app da Meta com "Login do Facebook" e esta URL de retorno cadastrada).
 */
export const SCOPES = [
    "pages_show_list", "pages_read_engagement", "pages_manage_posts",
    "instagram_basic", "instagram_content_publish", "business_management",
].join(",");

const STATE_TTL_MS = 10 * 60 * 1000;

export function configuracaoMeta(): { appId: string; appSecret: string } | null {
    const appId = process.env.SOCIAL_META_APP_ID?.trim();
    const appSecret = process.env.SOCIAL_META_APP_SECRET?.trim();
    return appId && appSecret ? { appId, appSecret } : null;
}

export function urlDeRetorno(origin: string): string {
    const base = (process.env.BASE_URL || process.env.NEXTAUTH_URL || origin).replace(/\/$/, "");
    return `${base}/api/social/oauth/callback`;
}

const assinar = (corpo: string, secret: string) => createHmac("sha256", secret).update(corpo).digest("base64url");

/** "usuario.expiraEm.assinatura": prova que o retorno da Meta vem de um início de conexão feito por este usuário. */
export function criarEstado(userId: string, secret: string, agora = Date.now()): string {
    const corpo = `${Buffer.from(userId).toString("base64url")}.${agora + STATE_TTL_MS}`;
    return `${corpo}.${assinar(corpo, secret)}`;
}

export function lerEstado(estado: string, secret: string, agora = Date.now()): string | null {
    const partes = estado.split(".");
    if (partes.length !== 3) return null;
    const corpo = `${partes[0]}.${partes[1]}`;
    const esperado = Buffer.from(assinar(corpo, secret));
    const recebido = Buffer.from(partes[2]);
    if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
    if (!(Number(partes[1]) > agora)) return null;
    return Buffer.from(partes[0], "base64url").toString("utf8");
}

/**
 * Com SOCIAL_META_CONFIG_ID (app com "Login do Facebook para Empresas") as permissões vêm da configuração criada no painel
 * e a Meta recusa o parâmetro `scope`; sem ele, usa o Login do Facebook comum com a lista SCOPES.
 */
export function urlDeAutorizacao(appId: string, redirectUri: string, estado: string, configId = process.env.SOCIAL_META_CONFIG_ID?.trim()): string {
    const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state: estado, response_type: "code" });
    if (configId) {
        q.set("config_id", configId);
        q.set("override_default_response_type", "true");
    } else q.set("scope", SCOPES);
    return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${q}`;
}

async function pedirToken(params: Record<string, string>): Promise<string> {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`, { method: "POST", body: new URLSearchParams(params) });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string } };
    if (!res.ok || !json.access_token) throw new Error(json.error?.message || `Erro ${res.status} da Meta ao trocar o código`);
    return json.access_token;
}

/** Troca o código do retorno por um token de usuário de longa duração (os tokens das Páginas dele não expiram). */
export async function trocarCodigoPorToken(code: string, redirectUri: string, appId: string, appSecret: string): Promise<string> {
    const curto = await pedirToken({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code });
    return pedirToken({ grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: curto });
}
