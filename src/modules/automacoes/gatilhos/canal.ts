import { classifySendFailure, type FailureClass } from "@/lib/send-failure";

/** Janelas oficiais de mensagens (Meta): 24 h para responder DM; 7 dias para a resposta privada a um comentário. */
export const JANELA_DM_MS = 24 * 3_600_000;
export const JANELA_RESPOSTA_PRIVADA_MS = 7 * 24 * 3_600_000;

export const dmDentroDaJanela = (ultimaMensagemDoUsuarioMs: number, agoraMs: number) => agoraMs - ultimaMensagemDoUsuarioMs <= JANELA_DM_MS && agoraMs >= ultimaMensagemDoUsuarioMs;
export const respostaPrivadaDentroDaJanela = (comentarioMs: number, agoraMs: number) => agoraMs - comentarioMs <= JANELA_RESPOSTA_PRIVADA_MS && agoraMs >= comentarioMs;

/** Erros da Graph API de mensagens (forma { code, subcode, message }), classificados como o resto do CRM (`send-failure`). */
export interface ErroCanal { code?: number; subcode?: number; message?: string }

const FORA_DA_JANELA = new Set([2534022, 2018278, 2534066]); // subcodes (com code 10) de "fora da janela de mensagens"
const LIMITE_TAXA = new Set([4, 17, 32, 613, 80002, 80006, 80007]);
const SEM_PERMISSAO_OU_TOKEN = new Set([102, 190, 200, 299]);

export interface ClassificacaoCanal { classe: FailureClass; motivo: "fora_da_janela" | "limite_de_taxa" | "permissao_ou_token" | "usuario_indisponivel" | "bloqueado" | "outro"; reconectar: boolean }

export function classificarErroCanal(e: ErroCanal | unknown): ClassificacaoCanal {
    const x = (typeof e === "object" && e !== null ? e : {}) as ErroCanal;
    const code = x.code, sub = x.subcode;
    if (code === 10 && sub !== undefined && FORA_DA_JANELA.has(sub)) return { classe: "policy", motivo: "fora_da_janela", reconectar: false };
    if (code !== undefined && LIMITE_TAXA.has(code)) return { classe: "transient", motivo: "limite_de_taxa", reconectar: false }; // a Meta recusou: nada saiu
    if (code === 551) return { classe: "permanent", motivo: "usuario_indisponivel", reconectar: false };
    if (code === 368) return { classe: "policy", motivo: "bloqueado", reconectar: false };
    if (code !== undefined && SEM_PERMISSAO_OU_TOKEN.has(code)) return { classe: "permanent", motivo: "permissao_ou_token", reconectar: true };
    if (code === 1 || code === 2) return { classe: "unknown", motivo: "outro", reconectar: false }; // falha interna da Meta: pode ter saído
    return { classe: classifySendFailure(new Error(x.message ?? "erro"), { sendAttempted: true }), motivo: "outro", reconectar: false };
}
