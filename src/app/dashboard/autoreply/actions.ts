"use server";

import { prisma } from "@/lib/prisma";
import { canAccessSession } from "@/lib/api-auth";
import { getAuthenticatedUserForAction } from "@/lib/server-action-auth";
import { Prisma } from "@prisma/client";
import { MATCH_TYPES } from "@/modules/whatsapp/store/autoreply-match";

const TRIGGER_TYPES = ["ALL", "GROUP", "PRIVATE"];

/** Mesmos valores aceitos pela API (/api/autoreplies): evita gravar tipos que o motor de respostas não reconhece. */
function validarTipos(data: { matchType?: string; triggerType?: string }) {
    if (data.matchType && !(MATCH_TYPES as readonly string[]).includes(data.matchType)) throw new Error("matchType inválido (use EXACT, CONTAINS, STARTS_WITH ou REGEX)");
    if (data.triggerType && !TRIGGER_TYPES.includes(data.triggerType)) throw new Error("triggerType inválido (use ALL, GROUP ou PRIVATE)");
}

// Fetch rules directly from DB without API call
export async function getAutoReplies(sessionId: string) {
    const nextAuthSession = await getAuthenticatedUserForAction();
    if (!nextAuthSession) {
        throw new Error("Não autorizado");
    }

    const canAccess = await canAccessSession(nextAuthSession.id, nextAuthSession.role, sessionId);
    if (!canAccess) {
        throw new Error("Acesso negado");
    }

    const session = await prisma.session.findUnique({
        where: { sessionId: sessionId },
        select: { id: true }
    });

    if (!session) {
        throw new Error("Sessão não encontrada");
    }

    const rules = await prisma.autoReply.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: 'desc' }
    });

    return rules;
}

// Create a new auto reply directly to DB
export async function createAutoReply(sessionId: string, data: { keyword: string; response?: string; matchType: string; isMedia: boolean; mediaUrl?: string | null; mediaType?: string | null; triggerType: string }) {
    const nextAuthSession = await getAuthenticatedUserForAction();
    if (!nextAuthSession) {
        throw new Error("Não autorizado");
    }

    if (!data.keyword || (!data.response && !data.mediaUrl)) {
        throw new Error("Palavra-chave e resposta (ou mídia) são obrigatórias");
    }
    validarTipos(data);

    const canAccess = await canAccessSession(nextAuthSession.id, nextAuthSession.role, sessionId);
    if (!canAccess) {
        throw new Error("Acesso negado");
    }

    const session = await prisma.session.findUnique({
        where: { sessionId: sessionId },
        select: { id: true }
    });

    if (!session) {
        throw new Error("Sessão não encontrada");
    }

    const createData: Prisma.AutoReplyUncheckedCreateInput = {
        sessionId: session.id,
        keyword: data.keyword,
        response: data.response || null,
        matchType: data.matchType || "EXACT",
        isMedia: !!data.mediaUrl,
        mediaUrl: data.mediaUrl || null,
        mediaType: data.mediaType || null,
        triggerType: data.triggerType || "ALL"
    };

    const newRule = await prisma.autoReply.create({
        data: createData
    });

    return newRule;
}

export async function deleteAutoReply(sessionId: string, ruleId: string) {
    const nextAuthSession = await getAuthenticatedUserForAction();
    if (!nextAuthSession) {
        throw new Error("Não autorizado");
    }

    const rule = await prisma.autoReply.findUnique({
        where: { id: ruleId },
        include: { session: true }
    });

    if (!rule) {
        throw new Error("Regra não encontrada");
    }

    const canAccess = await canAccessSession(nextAuthSession.id, nextAuthSession.role, rule.session.sessionId);
    if (!canAccess || rule.session.sessionId !== sessionId) {
        throw new Error("Acesso negado");
    }

    await prisma.autoReply.delete({ where: { id: ruleId } });
    return { success: true };
}

export async function updateAutoReply(sessionId: string, ruleId: string, data: { keyword: string; response?: string; matchType: string; isMedia: boolean; mediaUrl?: string | null; mediaType?: string | null; triggerType: string }) {
    const nextAuthSession = await getAuthenticatedUserForAction();
    if (!nextAuthSession) {
        throw new Error("Não autorizado");
    }

    if (!data.keyword || (!data.response && !data.mediaUrl)) {
        throw new Error("Palavra-chave e resposta (ou mídia) são obrigatórias");
    }
    validarTipos(data);

    const rule = await prisma.autoReply.findUnique({
        where: { id: ruleId },
        include: { session: true }
    });

    if (!rule) {
        throw new Error("Regra não encontrada");
    }

    const canAccess = await canAccessSession(nextAuthSession.id, nextAuthSession.role, rule.session.sessionId);
    if (!canAccess || rule.session.sessionId !== sessionId) {
        throw new Error("Acesso negado");
    }

    const updateData: Prisma.AutoReplyUncheckedUpdateInput = {
        keyword: data.keyword,
        response: data.response || null,
        matchType: data.matchType || "EXACT",
        isMedia: !!data.mediaUrl,
        mediaUrl: data.mediaUrl || null,
        mediaType: data.mediaType || null,
        triggerType: data.triggerType || "ALL"
    };

    const updatedRule = await prisma.autoReply.update({
        where: { id: ruleId },
        data: updateData
    });

    return updatedRule;
}
