import { prisma } from "@/lib/prisma";

/**
 * Personalização de mensagens de disparo.
 *
 * Variáveis aceitas no texto (com ou sem texto reserva depois de "|"):
 *   {primeironome}            → "Maria"
 *   {primeironome|cliente}    → "Maria", ou "cliente" se o nome não for conhecido
 *   {nome}                    → "Maria da Silva"
 */

const VAR_RE = /([ \t]*,?[ \t]*)?\{\s*(primeironome|nome)\s*(?:\|\s*([^}]*?)\s*)?\}/gi;

function looksLikeRealName(raw: string | null | undefined): raw is string {
    if (!raw) return false;
    const t = raw.trim();
    // ignora números de telefone, "+55 61 ..." e textos sem nenhuma letra
    if (/^[+\d\s()-]+$/.test(t)) return false;
    return /\p{L}{2,}/u.test(t);
}

const PARTICLES = new Set(["da", "de", "do", "das", "dos", "e"]);

function titleCase(word: string): string {
    const lower = word.toLocaleLowerCase("pt-BR");
    if (PARTICLES.has(lower)) return lower;
    const isAllUpper = word === word.toLocaleUpperCase("pt-BR") && word.length > 1;
    const isAllLower = word === lower;
    if (isAllUpper || isAllLower) return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
    return word; // "McDonald", "Ana" etc.
}

export function extractNames(raw: string | null | undefined): { full: string; first: string } | null {
    if (!looksLikeRealName(raw)) return null;
    // remove emojis/símbolos do começo e do fim ("🌸 Maria ✨" → "Maria")
    const clean = raw.trim().replace(/^[^\p{L}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "");
    if (!looksLikeRealName(clean)) return null;
    const words = clean.split(/\s+/).map(titleCase);
    return { full: words.join(" "), first: words[0] };
}

export function applyPlaceholders(text: string, name: string | null | undefined): string {
    if (!VAR_RE.test(text)) return text;
    VAR_RE.lastIndex = 0;
    const names = extractNames(name);
    const out = text.replace(VAR_RE, (_m, prefix: string | undefined, variable: string, fallback?: string) => {
        const value = names ? (variable.toLowerCase() === "nome" ? names.full : names.first) : (fallback ?? "");
        // sem valor: some junto com a vírgula/espaço que vinha antes ("Oi, {x}!" → "Oi!")
        return value ? (prefix ?? "") + value : "";
    });
    // arruma espaços/pontuação quando a variável ficou vazia ("Oi , tudo bem" → "Oi, tudo bem")
    return out.replace(/^[ \t]*[,;:][ \t]*/gm, "").replace(/[ \t]+([,!.?;:])/g, "$1").replace(/[ \t]{2,}/g, " ");
}

export function hasPlaceholders(text: string): boolean {
    const r = VAR_RE.test(text);
    VAR_RE.lastIndex = 0;
    return r;
}

/** Busca o melhor nome conhecido para um número: agenda → nome no WhatsApp → último pushName. */
export async function resolveContactName(dbSessionId: string, jids: string[]): Promise<string | null> {
    const digits = jids.map((j) => j.split("@")[0].split(":")[0]).filter(Boolean);
    const candidates = [...new Set([...jids, ...digits.map((d) => `${d}@s.whatsapp.net`)])];

    const contact = await prisma.contact.findFirst({
        where: {
            sessionId: dbSessionId,
            OR: [{ jid: { in: candidates } }, { remoteJidAlt: { in: candidates } }, { lid: { in: candidates } }],
        },
        select: { name: true, notify: true, verifiedName: true },
    });
    for (const n of [contact?.name, contact?.notify, contact?.verifiedName]) {
        if (extractNames(n)) return n!;
    }

    const msg = await prisma.message.findFirst({
        where: { sessionId: dbSessionId, fromMe: false, remoteJid: { in: candidates }, pushName: { not: null } },
        orderBy: { timestamp: "desc" },
        select: { pushName: true },
    });
    return msg?.pushName ?? null;
}

/** Personaliza um texto para um destinatário, usando o sessionId textual da sessão (ex.: "1"). */
export async function personalizeFor(sessionKey: string, jid: string, text: string, extraJids: string[] = []): Promise<string> {
    if (!hasPlaceholders(text)) return text;
    const session = await prisma.session.findUnique({ where: { sessionId: sessionKey }, select: { id: true } });
    const name = session ? await resolveContactName(session.id, [jid, ...extraJids]) : null;
    return applyPlaceholders(text, name);
}

/**
 * Auto-salvar: cria/atualiza contatos usando o nome que o cliente usa no WhatsApp (pushName)
 * das mensagens já recebidas. Só preenche o que está vazio; nunca sobrescreve um nome salvo.
 */
export async function backfillContactNames(dbSessionId: string): Promise<void> {
    await prisma.$executeRawUnsafe(
        `INSERT INTO \`Contact\` (id, sessionId, jid, notify, name, createdAt, updatedAt)
         SELECT UUID(), m.sessionId, m.remoteJid, m.pn, m.pn, NOW(3), NOW(3)
         FROM (
            SELECT sessionId, remoteJid,
                   SUBSTRING_INDEX(GROUP_CONCAT(pushName ORDER BY timestamp DESC SEPARATOR '|'), '|', 1) AS pn
            FROM \`Message\`
            WHERE sessionId = ? AND fromMe = 0 AND pushName IS NOT NULL AND pushName <> ''
              AND remoteJid LIKE '%@s.whatsapp.net'
            GROUP BY sessionId, remoteJid
         ) m
         LEFT JOIN \`Contact\` c ON c.sessionId = m.sessionId AND c.jid = m.remoteJid
         WHERE c.id IS NULL`,
        dbSessionId
    );
    await prisma.$executeRawUnsafe(
        `UPDATE \`Contact\` c
         JOIN (
            SELECT sessionId, remoteJid,
                   SUBSTRING_INDEX(GROUP_CONCAT(pushName ORDER BY timestamp DESC SEPARATOR '|'), '|', 1) AS pn
            FROM \`Message\`
            WHERE sessionId = ? AND fromMe = 0 AND pushName IS NOT NULL AND pushName <> ''
            GROUP BY sessionId, remoteJid
         ) m ON m.sessionId = c.sessionId AND m.remoteJid = c.jid
         SET c.notify = m.pn
         WHERE (c.notify IS NULL OR c.notify = '')`,
        dbSessionId
    );
}
