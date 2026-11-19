import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/modules/social/crypto";
import type { DepsSocial } from "../executor";
import type { Canal } from "../gatilhos/catalogo";
import { enviarTextoSocial, ErroEnvioSocial } from "./meta-social";

const PROVEDOR: Record<Canal, string> = { instagram: "instagram", messenger: "facebook" };

/** contactKey "<canal>:<id do remetente>" (montado pelo roteador de gatilhos). */
function partes(contactKey: string): { canal: Canal; remetenteId: string } | null {
    const i = contactKey.indexOf(":");
    const canal = contactKey.slice(0, i);
    return (canal === "instagram" || canal === "messenger") && contactKey.length > i + 1 ? { canal, remetenteId: contactKey.slice(i + 1) } : null;
}

const conta = (userId: string, canal: Canal, vars: Record<string, unknown>) =>
    typeof vars.conta_externa_id === "string"
        ? prisma.socialAccount.findFirst({ where: { userId, provider: PROVEDOR[canal], externalId: vars.conta_externa_id }, select: { id: true, pageId: true, accessToken: true } })
        : Promise.resolve(null);

/** Dependências reais do executor para Instagram/Messenger: token da Página guardado criptografado em SocialAccount. */
export const depsSocialReais: DepsSocial = {
    async contaAtiva(userId, contactKey, vars) {
        const p = partes(contactKey);
        return !!p && !!(await conta(userId, p.canal, vars));
    },
    // Mesma tabela de opt-out do roteador: sessionId "social:<accountId>", phoneKey = id do remetente.
    async optedOut(userId, contactKey, vars) {
        const p = partes(contactKey);
        const c = p && (await conta(userId, p.canal, vars));
        if (!p || !c) return false;
        return !!(await prisma.optOut.findUnique({ where: { sessionId_phoneKey: { sessionId: `social:${c.id}`, phoneKey: p.remetenteId } }, select: { id: true } }));
    },
    async enviarTexto({ userId, contactKey, texto, vars, agoraMs }) {
        const p = partes(contactKey);
        const c = p && (await conta(userId, p.canal, vars));
        if (!p || !c) throw new ErroEnvioSocial("permanent", "sem_token", "conta social não encontrada: reconecte a conta no CRM", true);
        let token: string | undefined;
        try { token = decryptToken(c.accessToken); } catch { token = undefined; }
        const comentario = typeof vars.comentario_id === "string" ? vars.comentario_id : undefined;
        if (comentario && vars.resposta_privada_enviada === true)
            throw new ErroEnvioSocial("policy", "resposta_privada_ja_usada", "a Meta permite uma única resposta privada por comentário; a conversa só continua depois que a pessoa responder");
        return enviarTextoSocial({
            canal: p.canal, pageId: c.pageId, token, texto, destinatarioId: p.remetenteId, comentarioId: comentario,
            janelaAteMs: typeof vars.janela_ate_ms === "number" ? vars.janela_ate_ms : 0, agoraMs,
        });
    },
};
