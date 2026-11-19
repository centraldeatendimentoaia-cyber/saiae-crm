import { SCOPES } from "@/modules/social/oauth";

/**
 * Catálogo e diagnóstico dos gatilhos oficiais da Meta (Instagram/Messenger). Tudo fica DESLIGADO por padrão e só
 * liga com flag explícita E permissão efetivamente disponível; sem uma das duas o gatilho aparece como desabilitado
 * com o motivo, nunca como sucesso simulado.
 */

export type TipoGatilho = "dm_palavra_chave" | "dm_qualquer" | "comentario_post";
export type Canal = "instagram" | "messenger";

export interface DefinicaoGatilho {
    id: string;
    tipo: TipoGatilho;
    canal: Canal;
    titulo: string;
    /** Qualquer uma destas, por canal, basta (a Meta tem nomes distintos por produto); todas listadas para o diagnóstico. */
    permissoesExigidas: string[];
    /** Campo de webhook a assinar no app da Meta. */
    campoWebhook: string;
    flag: string;
}

export const GATILHOS: DefinicaoGatilho[] = [
    { id: "instagram_dm_palavra_chave", tipo: "dm_palavra_chave", canal: "instagram", titulo: "Instagram: DM com palavra-chave", permissoesExigidas: ["instagram_manage_messages", "pages_messaging"], campoWebhook: "messages", flag: "AUTOMACOES_GATILHO_IG_DM" },
    { id: "instagram_dm_qualquer", tipo: "dm_qualquer", canal: "instagram", titulo: "Instagram: qualquer DM", permissoesExigidas: ["instagram_manage_messages", "pages_messaging"], campoWebhook: "messages", flag: "AUTOMACOES_GATILHO_IG_DM" },
    { id: "instagram_comentario_post", tipo: "comentario_post", canal: "instagram", titulo: "Instagram: comentário em post (resposta privada)", permissoesExigidas: ["instagram_manage_comments", "instagram_manage_messages", "pages_messaging"], campoWebhook: "comments", flag: "AUTOMACOES_GATILHO_IG_COMENTARIO" },
    { id: "messenger_dm_palavra_chave", tipo: "dm_palavra_chave", canal: "messenger", titulo: "Messenger: DM com palavra-chave", permissoesExigidas: ["pages_messaging"], campoWebhook: "messages", flag: "AUTOMACOES_GATILHO_MSGR_DM" },
    { id: "messenger_dm_qualquer", tipo: "dm_qualquer", canal: "messenger", titulo: "Messenger: qualquer DM", permissoesExigidas: ["pages_messaging"], campoWebhook: "messages", flag: "AUTOMACOES_GATILHO_MSGR_DM" },
    { id: "messenger_comentario_post", tipo: "comentario_post", canal: "messenger", titulo: "Messenger: comentário em post da Página (resposta privada)", permissoesExigidas: ["pages_read_user_content", "pages_manage_metadata", "pages_messaging"], campoWebhook: "feed", flag: "AUTOMACOES_GATILHO_MSGR_COMENTARIO" },
];

/** Permissões que o app pede no OAuth sem config_id (fonte única: src/modules/social/oauth.ts). */
export const PERMISSOES_DISPONIVEIS: string[] = SCOPES.split(",");

export type EstadoGatilho = "habilitado" | "sem_provedor_de_envio" | "desabilitado_flag" | "bloqueado_permissao" | "webhook_nao_configurado";

export interface DiagnosticoGatilho {
    id: string;
    titulo: string;
    canal: Canal;
    flag: string;
    permissoesExigidas: string[];
    permissoesFaltando: string[];
    estado: EstadoGatilho;
    motivo: string;
}

export interface AmbienteGatilhos {
    env: Record<string, string | undefined>;
    permissoes: string[];
    /** Existe provedor de envio Instagram/Messenger no executor? Sim: canais/meta-social.ts (texto e resposta privada). */
    provedorDeCanal: boolean;
}

export const ambienteReal = (): AmbienteGatilhos => ({ env: process.env, permissoes: PERMISSOES_DISPONIVEIS, provedorDeCanal: true });

export const flagLigada = (env: AmbienteGatilhos["env"], nome: string) => env[nome]?.trim().toLowerCase() === "true";

/** O gatilho exige TODAS as permissões listadas. Ordem: flag, permissão, webhook, provedor de envio. */
export function diagnosticarGatilho(g: DefinicaoGatilho, amb: AmbienteGatilhos): DiagnosticoGatilho {
    const faltando = g.permissoesExigidas.filter((p) => !amb.permissoes.includes(p));
    const base = { id: g.id, titulo: g.titulo, canal: g.canal, flag: g.flag, permissoesExigidas: g.permissoesExigidas, permissoesFaltando: faltando };
    if (!flagLigada(amb.env, g.flag)) return { ...base, estado: "desabilitado_flag", motivo: `flag ${g.flag} desligada (padrão)` };
    if (faltando.length) return { ...base, estado: "bloqueado_permissao", motivo: `permissão da Meta não liberada para o app: ${faltando.join(", ")} (exige revisão do app na Meta)` };
    if (!amb.env.SOCIAL_META_APP_SECRET?.trim() || !amb.env.SOCIAL_WEBHOOK_VERIFY_TOKEN?.trim())
        return { ...base, estado: "webhook_nao_configurado", motivo: "faltam SOCIAL_META_APP_SECRET e/ou SOCIAL_WEBHOOK_VERIFY_TOKEN para o webhook" };
    if (!amb.provedorDeCanal) return { ...base, estado: "sem_provedor_de_envio", motivo: "o executor de automações ainda não tem provedor de envio para Instagram/Messenger (só WhatsApp); o gatilho não pode responder" };
    return { ...base, estado: "habilitado", motivo: "flag ligada, permissões presentes, webhook e provedor de envio disponíveis" };
}

export const diagnosticarGatilhos = (amb: AmbienteGatilhos = ambienteReal()): DiagnosticoGatilho[] => GATILHOS.map((g) => diagnosticarGatilho(g, amb));

export const gatilhoHabilitado = (id: string, amb: AmbienteGatilhos): boolean => {
    const g = GATILHOS.find((x) => x.id === id);
    return !!g && diagnosticarGatilho(g, amb).estado === "habilitado";
};
