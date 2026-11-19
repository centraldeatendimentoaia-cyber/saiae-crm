import { GRAPH_VERSION } from "@/modules/social/graph";
import { classificarErroCanal } from "../gatilhos/canal";
import type { Canal } from "../gatilhos/catalogo";
import type { FailureClass } from "@/lib/send-failure";

/**
 * Envio de texto por Instagram DM, Messenger DM e resposta privada a comentário, com o token da Página (Graph API).
 * Docs: Messenger Send API (POST /{PAGE_ID}/messages, messaging_type RESPONSE), Instagram Messaging API (mesmo endpoint
 * com o token da Página e recipient.id = IGSID) e Private Replies (recipient.comment_id, uma por comentário, até 7 dias).
 * O token vai no cabeçalho Authorization (nunca na URL) e nenhum erro devolvido carrega o corpo bruto da Meta.
 */

export const LIMITE_TEXTO: Record<Canal, { max: number; unidade: "bytes" | "caracteres" }> = {
    instagram: { max: 1000, unidade: "bytes" },
    messenger: { max: 2000, unidade: "caracteres" },
};
const TIMEOUT_MS = 15_000;

export type MotivoErroSocial =
    | "sem_token" | "texto_invalido" | "fora_da_janela" | "limite_de_taxa" | "permissao_ou_token" | "usuario_indisponivel"
    | "bloqueado" | "recusado" | "indisponivel" | "resultado_desconhecido" | "resposta_privada_ja_usada" | "template_so_whatsapp" | "outro";

/** Erro de envio já classificado (transient/permanent/policy/unknown), com mensagem segura para gravar. */
export class ErroEnvioSocial extends Error {
    constructor(public classe: FailureClass, public motivo: MotivoErroSocial, mensagem: string, public reconectar = false) {
        super(mensagem);
        this.name = "ErroEnvioSocial";
    }
}

export interface EnvioSocial {
    canal: Canal;
    pageId: string;
    /** Token da Página já descriptografado; ausente = conta precisa reconectar. */
    token: string | undefined;
    texto: string;
    /** DM: PSID/IGSID de quem escreveu. */
    destinatarioId?: string;
    /** Comentário: se informado, envia a resposta privada (uma por comentário). */
    comentarioId?: string;
    /** Fim da janela (ms): 24 h após a última mensagem (DM) ou 7 dias após o comentário. */
    janelaAteMs: number;
    agoraMs: number;
    fetchImpl?: typeof fetch;
}

const tamanho = (canal: Canal, t: string) => (LIMITE_TEXTO[canal].unidade === "bytes" ? Buffer.byteLength(t, "utf8") : t.length);

interface RespostaGraph { message_id?: string; error?: { code?: number; error_subcode?: number } }

export async function enviarTextoSocial(i: EnvioSocial): Promise<{ messageId: string | null; privada: boolean }> {
    const privada = !!i.comentarioId;
    if (!i.token) throw new ErroEnvioSocial("permanent", "sem_token", "conta social sem token: reconecte a conta no CRM", true);
    const texto = i.texto.trim();
    if (!texto || tamanho(i.canal, texto) > LIMITE_TEXTO[i.canal].max)
        throw new ErroEnvioSocial("permanent", "texto_invalido", `texto vazio ou acima do limite de ${LIMITE_TEXTO[i.canal].max} ${LIMITE_TEXTO[i.canal].unidade} do ${i.canal}`);
    if (!privada && !i.destinatarioId) throw new ErroEnvioSocial("permanent", "texto_invalido", "destinatário ausente");
    // Janela conferida ANTES de falar com a Meta: fora dela nada sai (o human_agent de 7 dias não é usado: exige revisão da Meta e envio humano).
    if (!(i.agoraMs <= i.janelaAteMs)) throw new ErroEnvioSocial("policy", "fora_da_janela", privada ? "resposta privada fora dos 7 dias do comentário" : "janela de 24 h da conversa fechada: mensagem não enviada");

    const corpo = {
        recipient: privada ? { comment_id: i.comentarioId } : { id: i.destinatarioId },
        ...(!privada && i.canal === "messenger" ? { messaging_type: "RESPONSE" } : {}),
        message: { text: texto },
    };
    let res: Response;
    try {
        res = await (i.fetchImpl ?? fetch)(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(i.pageId)}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${i.token}` },
            body: JSON.stringify(corpo),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch {
        // Rede/tempo esgotado: a Meta pode ter aceitado. Nunca reenviar sozinho.
        throw new ErroEnvioSocial("unknown", "resultado_desconhecido", "falha de rede ao enviar: a mensagem pode ter saído; confira na conversa");
    }
    const json = (await res.json().catch(() => ({}))) as RespostaGraph;
    if (res.ok && !json.error) {
        if (!json.message_id) throw new ErroEnvioSocial("unknown", "resultado_desconhecido", "a Meta respondeu sem id da mensagem: pode ter saído; confira na conversa");
        return { messageId: json.message_id, privada };
    }
    const code = json.error?.code, sub = json.error?.error_subcode;
    const ref = `HTTP ${res.status}${code !== undefined ? `, código ${code}${sub !== undefined ? `/${sub}` : ""}` : ""}`;
    const c = classificarErroCanal({ code, subcode: sub, message: `HTTP ${res.status}` });
    if (c.motivo !== "outro") return falha(c.classe, c.motivo, ref, c.reconectar);
    if (code === undefined && res.status >= 500) throw new ErroEnvioSocial("transient", "indisponivel", `Meta indisponível (${ref})`);
    if (res.status >= 500) throw new ErroEnvioSocial("unknown", "resultado_desconhecido", `falha interna da Meta (${ref}): pode ter saído; confira na conversa`);
    throw new ErroEnvioSocial(res.status === 429 ? "transient" : "permanent", res.status === 429 ? "limite_de_taxa" : "recusado", `Meta recusou o envio (${ref})`);
}

const TEXTO_MOTIVO: Partial<Record<MotivoErroSocial, string>> = {
    fora_da_janela: "fora da janela de mensagens", limite_de_taxa: "limite de taxa da Meta", permissao_ou_token: "token ou permissão inválidos: reconecte a conta",
    usuario_indisponivel: "usuário indisponível", bloqueado: "envio bloqueado pela Meta",
};
function falha(classe: FailureClass, motivo: MotivoErroSocial, ref: string, reconectar: boolean): never {
    throw new ErroEnvioSocial(classe, motivo, `${TEXTO_MOTIVO[motivo] ?? "erro da Meta"} (${ref})`, reconectar);
}
