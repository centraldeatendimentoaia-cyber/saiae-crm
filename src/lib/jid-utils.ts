import { prisma } from "./prisma";
import { logger } from "./logger";

/**
 * Check if a JID is in @lid format (WhatsApp Linked ID)
 */
export function isLidJid(jid: string | undefined | null): boolean {
    if (!jid) return false;
    return jid.endsWith("@lid");
}

/**
 * Normalize a JID to standard format.
 * Primarily ensures that @c.us is converted to @s.whatsapp.net.
 * Does not touch @g.us or @broadcast.
 */
export function normalizeJid(jid: string | undefined | null): string {
    if (!jid) return "";
    if (jid.endsWith("@c.us")) {
        return jid.replace("@c.us", "@s.whatsapp.net");
    }
    return jid;
}

/**
 * Resolve a @lid JID to @s.whatsapp.net phone number JID.
 * 
 * Resolution strategy:
 *   1. Inline remoteJidAlt (from Baileys message key) if provided
 *   2. DB Contact lookup (contact.remoteJidAlt or matching by lid field)
 *   3. Falls back to the original JID if no resolution is found
 *
 * For non-LID JIDs: returns the original JID unchanged.
 * For group JIDs (@g.us) or broadcast: returns unchanged.
 */
export async function resolveToPhoneJid(
    jid: string,
    dbSessionId: string,
    inlineAlt?: string | null,
    /** Última tentativa: pergunta ao mapeamento do WhatsApp (ver telefoneDoLid). */
    viaSocket?: (lid: string) => Promise<string | null>
): Promise<string> {
    if (!jid) return jid;

    // Only resolve if it's a @lid JID
    if (!isLidJid(jid)) return jid;

    // 1. Use inline remoteJidAlt if provided
    if (inlineAlt && !isLidJid(inlineAlt)) {
        return inlineAlt;
    }

    // 2. Try DB lookup
    try {
        const contact = await prisma.contact.findFirst({
            where: {
                sessionId: dbSessionId,
                OR: [
                    { jid: jid },
                    { lid: jid }
                ]
            },
            select: { jid: true, remoteJidAlt: true, lid: true }
        });

        if (contact) {
            // If remoteJidAlt is a phone JID, use it
            if (contact.remoteJidAlt && !isLidJid(contact.remoteJidAlt)) {
                return contact.remoteJidAlt;
            }
            // If the primary jid is a phone JID, use it
            if (contact.jid && !isLidJid(contact.jid)) {
                return contact.jid;
            }
        }
    } catch (e) {
        logger.error("JID", `resolveToPhoneJid: DB lookup failed for ${jid}`, e);
    }

    // 3. Mapeamento do próprio WhatsApp
    if (viaSocket) {
        const telefone = await viaSocket(jid);
        if (telefone && !isLidJid(telefone)) return telefone;
    }

    // 4. Fallback: return original JID
    return jid;
}

/** Telefone (@s.whatsapp.net) de um LID segundo o mapeamento que o Baileys guarda; null se não souber. */
export async function telefoneDoLid(
    sock: { signalRepository?: { lidMapping?: { getPNForLID: (lid: string) => Promise<string | null> } } },
    lid: string
): Promise<string | null> {
    try {
        const pn = await sock.signalRepository?.lidMapping?.getPNForLID(lid);
        return pn ? normalizeJid(pn.replace(/:\d+@/, "@")) : null;
    } catch (e) {
        logger.debug("JID", `getPNForLID falhou para ${lid}: ${(e as Error)?.message ?? "erro"}`);
        return null;
    }
}

/**
 * Resolve a @lid JID using sessionId (string, e.g., "session-01") instead of dbSessionId (cuid).
 * This is a convenience wrapper that first looks up the DB session ID.
 */
export async function resolveToPhoneJidBySessionId(
    jid: string,
    sessionId: string,
    inlineAlt?: string | null
): Promise<string> {
    if (!jid || !isLidJid(jid)) return jid;

    // 1. Use inline remoteJidAlt if provided
    if (inlineAlt && !isLidJid(inlineAlt)) {
        return inlineAlt;
    }

    try {
        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        if (session) {
            return resolveToPhoneJid(jid, session.id, inlineAlt);
        }
    } catch (e) {
        logger.error("JID", `resolveToPhoneJidBySessionId: Session lookup failed for ${sessionId}`, e);
    }

    return jid;
}

/**
 * Batch resolve multiple JIDs at once (efficient for lists).
 * Builds a LID→Phone lookup map from the Contact table in a single query,
 * then applies it to all provided JIDs.
 */
export async function batchResolveToPhoneJid(
    jids: string[],
    dbSessionId: string
): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const lids = jids.filter(j => isLidJid(j));

    // No LIDs to resolve, return identity map
    if (lids.length === 0) {
        jids.forEach(j => result.set(j, j));
        return result;
    }

    // Batch query: find contacts that match any of the LID JIDs
    try {
        const contacts = await prisma.contact.findMany({
            where: {
                sessionId: dbSessionId,
                OR: [
                    { jid: { in: lids } },
                    { lid: { in: lids } }
                ]
            },
            select: { jid: true, lid: true, remoteJidAlt: true }
        });

        // Build lookup map
        for (const c of contacts) {
            const phoneJid = (c.remoteJidAlt && !isLidJid(c.remoteJidAlt))
                ? c.remoteJidAlt
                : (!isLidJid(c.jid) ? c.jid : null);

            if (phoneJid) {
                // Map by jid (if it's a LID)
                if (isLidJid(c.jid)) {
                    result.set(c.jid, phoneJid);
                }
                // Map by lid field
                if (c.lid && isLidJid(c.lid)) {
                    result.set(c.lid, phoneJid);
                }
            }
        }
    } catch (e) {
        logger.error("JID", `batchResolveToPhoneJid: DB query failed`, e);
    }

    // Fill in any un-resolved JIDs with themselves
    for (const jid of jids) {
        if (!result.has(jid)) {
            result.set(jid, jid);
        }
    }

    return result;
}

/** Campos de um contato que ligam o telefone ao LID da mesma pessoa. */
export interface ContatoJids {
    jid: string;
    lid?: string | null;
    remoteJidAlt?: string | null;
}

/**
 * Agrupa os JIDs que são a mesma pessoa. O WhatsApp entrega a mesma conversa ora pelo telefone
 * (@s.whatsapp.net), ora pelo LID (@lid): sem juntar, a lista mostra duas conversas.
 * Devolve, para cada JID conhecido, o conjunto de todos os JIDs equivalentes (ele incluído).
 */
export function agruparJidsEquivalentes(contatos: ContatoJids[]): Map<string, Set<string>> {
    const classes = new Map<string, Set<string>>();
    for (const c of contatos) {
        const ids = [c.jid, c.lid, c.remoteJidAlt].filter((x): x is string => !!x);
        const juntos = new Set<string>(ids);
        for (const id of ids) classes.get(id)?.forEach((v) => juntos.add(v));
        juntos.forEach((id) => classes.set(id, juntos));
    }
    return classes;
}

/** JID que representa o grupo de equivalentes: o telefone quando existe; senão o primeiro. */
export function jidCanonico(ids: Iterable<string>): string {
    const lista = [...ids];
    return lista.find((j) => !isLidJid(j)) ?? lista[0];
}
