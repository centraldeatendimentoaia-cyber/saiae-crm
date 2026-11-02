"use server";

import { errorMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { ChatService } from "@/modules/whatsapp/chat.service";
import { getAuthenticatedUserForAction } from "@/lib/server-action-auth";
import { canAccessSession } from "@/lib/api-auth";
import { executarUmaVez } from "@/lib/executar-uma-vez";

const CHAT_PAGE_SIZE = parseInt(process.env.NEXT_PUBLIC_CHAT_PAGE_SIZE || "50", 10);

// Fetch chat list with cursor-based pagination & search
export async function getChatsStatus(
    sessionId: string,
    limit = CHAT_PAGE_SIZE,
    before?: string,
    search?: string
) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Não autorizado");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Acesso negado");

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) throw new Error("Sessão não encontrada");

    return await ChatService.getChatsPage(session.id, limit, before, search);
}

// Fetch messages for a specific chat with cursor pagination
export async function getChatMessages(
    sessionId: string,
    jid: string,
    limit = 50,
    before?: string
) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Não autorizado");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Acesso negado");

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) throw new Error("Sessão não encontrada");

    const { messages, hasMore, jids } = await ChatService.getMessages(session.id, jid, limit, before);

    return {
        messages: messages.map((msg) => ({
            ...msg,
            timestamp: msg.timestamp instanceof Date
                ? msg.timestamp.toISOString()
                : String(msg.timestamp)
        })),
        hasMore,
        jids
    };
}

// Send a basic text message
// `clientId` identifica a tentativa de envio: repetir o mesmo clientId (duplo clique, Enter repetido) não envia de novo.
export async function sendChatMessage(sessionId: string, jid: string, text: string, quotedMessageId?: string, clientId?: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Não autorizado");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Acesso negado");

    const enviar = async () => {
        try {
            const enviada = await ChatService.sendTextMessage(sessionId, jid, { text }, undefined, quotedMessageId);
            return { success: true, keyId: enviada?.key?.id ?? null };
        } catch (error) {
            throw new Error(`Falha ao enviar a mensagem: ${errorMessage(error)}`);
        }
    };
    return clientId ? executarUmaVez(`${user.id}:${sessionId}:${clientId}`, enviar) : enviar();
}

// Upload and Send Media
export async function sendMediaMessage(formData: FormData) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Não autorizado");

    const sessionId = formData.get("sessionId") as string;
    const jid = formData.get("jid") as string;
    const file = formData.get("file") as File;
    const type = formData.get("type") as string;
    const caption = formData.get("caption") as string || "";

    if (!sessionId || !jid || !file || !type) {
        throw new Error("Campos obrigatórios ausentes");
    }

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Acesso negado");

    try {
        const buffer = Buffer.from(await file.arrayBuffer());

        await ChatService.sendMediaMessage(
            sessionId,
            jid,
            buffer,
            type,
            file.type,
            file.name,
            caption
        );

        return { success: true };
    } catch (error) {
        logger.error("Actions", "Media send error:", error);
        throw new Error(`Falha ao enviar a mídia: ${errorMessage(error)}`);
    }
}

// Marca a conversa como lida (zera o contador de não lidas)
export async function markChatRead(sessionId: string, jid: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Não autorizado");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Acesso negado");

    const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
    if (!session) throw new Error("Sessão não encontrada");

    // Telefone e LID da mesma pessoa são uma conversa só: marca todos como lidos.
    const agora = new Date();
    const jids = await ChatService.jidsEquivalentes(session.id, jid);
    await Promise.all(jids.map((j) => prisma.chatRead.upsert({
        where: { sessionId_jid: { sessionId: session.id, jid: j } },
        create: { sessionId: session.id, jid: j, lastReadAt: agora },
        update: { lastReadAt: agora }
    })));
    return { success: true };
}
