import { errorMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { normalizeJid, agruparJidsEquivalentes } from "@/lib/jid-utils";
import { juntarConversas, type LinhaConversa } from "@/modules/whatsapp/chat-lista";
import { waManager } from "@/modules/whatsapp/manager";
import { onMessageSent } from "@/lib/webhook";
import Sticker from "wa-sticker-formatter";
import { Prisma } from "@prisma/client";
import type { AnyMessageContent, MiscMessageGenerationOptions, WAMessage } from "@whiskeysockets/baileys";

/** Uma conversa da lista de chats, com a última mensagem. */
export interface ChatListItem {
    /** JID canônico (telefone quando se conhece). */
    jid: string;
    /** Todos os JIDs da mesma pessoa com mensagens (telefone e LID). */
    jids: string[];
    phoneJid: string;
    name: string | null;
    notify: string | null;
    profilePic: string | null;
    unread: number;
    lastMessage: { content: string | null; timestamp: string; type: string };
}

/** Mídia de uma requisição de envio: uma URL a baixar ou os bytes já prontos. */
type MediaRef = { url?: string } | Buffer;

/** Corpo de uma mensagem a enviar (campos que o serviço lê; o resto segue para o Baileys como veio). */
export interface OutgoingPayload {
    text?: string;
    caption?: string;
    mimetype?: string;
    fileName?: string;
    ptt?: boolean;
    mentions?: string[];
    image?: MediaRef;
    video?: MediaRef;
    audio?: MediaRef;
    document?: MediaRef;
    sticker?: string | Buffer | { url?: string; pack?: string; author?: string };
}

/** Baixa a mídia quando ela veio como { url }; se já são bytes (ou não há mídia), devolve como está. */
async function baixarSeUrl(ref: MediaRef | undefined, nome: string): Promise<MediaRef | undefined> {
    if (!ref || typeof ref !== "object" || Buffer.isBuffer(ref) || !ref.url) return ref;
    try {
        const res = await fetch(ref.url);
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        return Buffer.from(await res.arrayBuffer());
    } catch (e) {
        throw new Error(`Falha ao baixar ${nome} da URL: ${errorMessage(e)}`);
    }
}

export class ChatService {
    /** Última mensagem de cada JID (um registro por JID), da mais recente para a mais antiga. */
    private static async ultimasPorJid(
        dbSessionId: string,
        opcoes: { jids?: string[]; busca?: string; antes?: string; limite: number }
    ): Promise<LinhaConversa[]> {
        const { jids, busca, antes, limite } = opcoes;
        // Na busca, vale quem casa por contato (jids) ou quem só tem mensagens com o texto no JID (ex.: telefone sem contato).
        const porJids = jids?.length ? Prisma.sql`remoteJid IN (${Prisma.join(jids)})` : null;
        const porTexto = busca ? Prisma.sql`remoteJid LIKE ${`%${busca}%`}` : null;
        const filtroJids = porJids && porTexto ? Prisma.sql`AND (${porJids} OR ${porTexto})`
            : porJids ? Prisma.sql`AND ${porJids}`
            : porTexto ? Prisma.sql`AND ${porTexto}`
            : Prisma.empty;
        const filtroAntes = antes ? Prisma.sql`AND m1.timestamp < ${new Date(antes)}` : Prisma.empty;
        // GROUP BY (remoteJid, timestamp): o WhatsApp grava a hora em segundos, e duas mensagens no mesmo segundo
        // (ex.: a IA manda uma em seguida da outra) duplicavam a linha e gastavam vagas do LIMIT.
        return prisma.$queryRaw<LinhaConversa[]>(Prisma.sql`
            SELECT m1.remoteJid AS remoteJid, MAX(m1.content) AS content, m1.timestamp AS timestamp, MAX(m1.type) AS type
            FROM \`Message\` m1
            INNER JOIN (
                SELECT remoteJid, MAX(timestamp) AS max_ts
                FROM \`Message\`
                WHERE sessionId = ${dbSessionId} ${filtroJids}
                GROUP BY remoteJid
            ) m2 ON m1.remoteJid = m2.remoteJid AND m1.timestamp = m2.max_ts
            WHERE m1.sessionId = ${dbSessionId} ${filtroAntes}
            GROUP BY m1.remoteJid, m1.timestamp
            ORDER BY m1.timestamp DESC
            LIMIT ${limite}
        `);
    }

    /** JIDs que casam com o texto da busca (nome, apelido, telefone ou assunto do grupo), com os equivalentes. */
    private static async jidsDaBusca(dbSessionId: string, busca: string): Promise<string[]> {
        const soNumero = busca.replace(/[\s+()-]/g, "");
        const termo = /^\d+$/.test(soNumero) ? soNumero : busca;
        const [contatos, grupos] = await Promise.all([
            prisma.contact.findMany({
                where: {
                    sessionId: dbSessionId,
                    OR: [{ name: { contains: busca } }, { notify: { contains: busca } }, { jid: { contains: termo } }, { lid: { contains: termo } }, { remoteJidAlt: { contains: termo } }]
                },
                select: { jid: true, lid: true, remoteJidAlt: true },
                take: 300
            }),
            prisma.group.findMany({ where: { sessionId: dbSessionId, OR: [{ subject: { contains: busca } }, { jid: { contains: termo } }] }, select: { jid: true }, take: 100 })
        ]);
        const achados = new Set<string>(grupos.map((g) => g.jid));
        for (const c of contatos) [c.jid, c.lid, c.remoteJidAlt].forEach((j) => j && achados.add(j));
        return [...achados];
    }

    /** Contatos que ligam telefone e LID para os JIDs dados. */
    private static contatosLigados(dbSessionId: string, jids: string[]) {
        return prisma.contact.findMany({
            where: { sessionId: dbSessionId, OR: [{ jid: { in: jids } }, { lid: { in: jids } }, { remoteJidAlt: { in: jids } }] },
            select: { jid: true, lid: true, remoteJidAlt: true, name: true, notify: true, profilePic: true }
        });
    }

    /**
     * Uma página da lista de conversas. Telefone e LID da mesma pessoa viram UMA conversa.
     * `proximoCursor` vem da última linha bruta da página, para a paginação não pular conversas ao juntar.
     */
    static async getChatsPage(dbSessionId: string, limit = 50, before?: string, search?: string) {
        const vazia = { chats: [] as ChatListItem[], hasMore: false, proximoCursor: null as string | null };
        const busca = search?.trim();
        const jidsBusca = busca ? await ChatService.jidsDaBusca(dbSessionId, busca) : undefined;
        const soNumero = busca?.replace(/[\s+()-]/g, "") ?? "";
        const termoJid = busca ? (/^\d+$/.test(soNumero) ? soNumero : busca) : undefined;

        const pagina = await ChatService.ultimasPorJid(dbSessionId, { jids: jidsBusca, busca: termoJid, antes: before, limite: limit });
        if (pagina.length === 0) return vazia;
        const hasMore = pagina.length >= limit;
        const proximoCursor = pagina[pagina.length - 1].timestamp.toISOString();

        // Ligações telefone <-> LID; JIDs equivalentes que ficaram fora da página entram para somar o que falta.
        const contatos = await ChatService.contatosLigados(dbSessionId, pagina.map((l) => l.remoteJid));
        const classes = agruparJidsEquivalentes(contatos);
        const naPagina = new Set(pagina.map((l) => l.remoteJid));
        const faltando = [...new Set(pagina.flatMap((l) => [...(classes.get(l.remoteJid) ?? [])]))].filter((j) => !naPagina.has(j));
        const extras = faltando.length ? await ChatService.ultimasPorJid(dbSessionId, { jids: faltando, limite: faltando.length }) : [];
        const conversas = juntarConversas([...pagina, ...extras], classes);

        const todosJids = [...new Set(conversas.flatMap((c) => c.jids))];
        const lookupJids = [...new Set([...todosJids, ...conversas.map((c) => c.jid)])];
        const [infoContatos, groups] = await Promise.all([
            prisma.contact.findMany({
                where: { sessionId: dbSessionId, jid: { in: lookupJids } },
                select: { jid: true, name: true, notify: true, profilePic: true }
            }),
            prisma.group.findMany({
                where: { sessionId: dbSessionId, jid: { in: todosJids } },
                select: { jid: true, subject: true }
            })
        ]);

        // Não lidas: mensagens recebidas depois da última leitura registrada no painel.
        // Sem registro, vale o marco inicial (mensagens antigas contam como lidas).
        const baseline = new Date(process.env.UNREAD_BASELINE || "2026-10-06T00:00:00Z");
        const reads = await prisma.chatRead.findMany({
            where: { sessionId: dbSessionId, jid: { in: todosJids } },
            select: { jid: true, lastReadAt: true }
        });
        const readMap = new Map(reads.map(r => [r.jid, r.lastReadAt]));
        const unreadRows = await prisma.message.groupBy({
            by: ["remoteJid", "timestamp"],
            where: { sessionId: dbSessionId, fromMe: false, remoteJid: { in: todosJids }, timestamp: { gt: baseline } },
            _count: { _all: true }
        });
        const unreadMap = new Map<string, number>();
        for (const row of unreadRows) {
            const since = readMap.get(row.remoteJid) || baseline;
            if (row.timestamp > since) unreadMap.set(row.remoteJid, (unreadMap.get(row.remoteJid) || 0) + row._count._all);
        }

        const infoMap = new Map<string, { name: string | null; notify: string | null; profilePic: string | null }>();
        infoContatos.forEach(c => infoMap.set(c.jid, { name: c.name, notify: c.notify, profilePic: c.profilePic }));
        groups.forEach(g => infoMap.set(g.jid, { name: g.subject, notify: g.subject, profilePic: null }));

        const chats: ChatListItem[] = conversas.map((c) => {
            const infos = [c.jid, ...c.jids].map((j) => infoMap.get(j)).filter((i): i is NonNullable<typeof i> => !!i);
            const primeiro = (k: "name" | "notify" | "profilePic") => infos.find((i) => i[k])?.[k] ?? null;
            return {
                jid: c.jid,
                jids: c.jids,
                phoneJid: c.jid,
                name: primeiro("name"),
                notify: primeiro("notify"),
                profilePic: primeiro("profilePic"),
                unread: c.jids.reduce((s, j) => s + (unreadMap.get(j) || 0), 0),
                lastMessage: { content: c.ultima.content, timestamp: c.ultima.timestamp.toISOString(), type: c.ultima.type }
            };
        });
        return { chats, hasMore, proximoCursor };
    }

    /** Lista de conversas (sem os dados de paginação). */
    static async getChatsList(dbSessionId: string, limit = 50, before?: string, search?: string) {
        return (await ChatService.getChatsPage(dbSessionId, limit, before, search)).chats;
    }

    /** Todos os JIDs da mesma pessoa que o JID dado (telefone, LID e alternativos), ele incluído. */
    static async jidsEquivalentes(dbSessionId: string, jid: string): Promise<string[]> {
        const normalizado = normalizeJid(jid);
        const contatos = await ChatService.contatosLigados(dbSessionId, [jid, normalizado]);
        const classes = agruparJidsEquivalentes(contatos);
        return [...new Set([jid, normalizado, ...(classes.get(jid) ?? []), ...(classes.get(normalizado) ?? [])])];
    }

    /**
     * Get messages for a specific chat with cursor pagination (infinite scroll).
     * @param before ISO timestamp — load messages older than this
     * @param limit max messages to return
     */
    static async getMessages(
        dbSessionId: string,
        jid: string,
        limit = 50,
        before?: string
    ) {
        // Telefone e LID da mesma pessoa são a mesma conversa
        const queryJids = await ChatService.jidsEquivalentes(dbSessionId, jid);

        const where: Prisma.MessageWhereInput = {
            sessionId: dbSessionId,
            remoteJid: { in: queryJids }
        };

        // Cursor-based: load older messages before this timestamp
        if (before) {
            where.timestamp = { lt: new Date(before) };
        }

        const messages = await prisma.message.findMany({
            where,
            orderBy: [{ timestamp: 'desc' }, { id: 'desc' }], // mesma hora (em segundos): o id (cuid) mantém a ordem de criação
            take: limit + 1 // fetch 1 extra to know if there's more
        });

        const hasMore = messages.length > limit;
        if (hasMore) messages.pop();

        // Fetch quoted messages
        const quoteIds = messages.map(m => m.quoteId).filter((id): id is string => !!id);
        const quotedMessagesMap = new Map<string, { content: string | null; fromMe: boolean; senderJid: string | null; pushName: string | null }>();
        if (quoteIds.length > 0) {
            try {
                const quotedMsgs = await prisma.message.findMany({
                    where: { sessionId: dbSessionId, keyId: { in: quoteIds } },
                    select: { keyId: true, content: true, fromMe: true, senderJid: true, pushName: true }
                });
                quotedMsgs.forEach(qm => {
                    quotedMessagesMap.set(qm.keyId, {
                        content: qm.content,
                        fromMe: qm.fromMe,
                        senderJid: qm.senderJid,
                        pushName: qm.pushName
                    });
                });
            } catch (e) {
                logger.error("ChatService", "Failed to batch load quoted messages:", e);
            }
        }

        const messagesWithQuote = messages.map((m) => {
            const quoted = m.quoteId ? quotedMessagesMap.get(m.quoteId) : undefined;
            return {
                ...m,
                quoted: quoted ? {
                    keyId: m.quoteId,
                    content: quoted.content,
                    fromMe: quoted.fromMe,
                    senderJid: quoted.senderJid,
                    pushName: quoted.pushName
                } : null
            };
        });

        // Return chronological order (oldest first)
        return {
            messages: messagesWithQuote.reverse(),
            hasMore,
            jids: queryJids
        };
    }

    static async sendTextMessage(sessionId: string, jid: string, messagePayload: OutgoingPayload | string, mentions?: string[], quotedMessageId?: string) {
        const instance = waManager.getInstance(sessionId);
        if (!instance || !instance.socket) {
            throw new Error("WhatsApp session is disconnected or not found");
        }

        // Handle quoted/reply message
        let quotedOption: MiscMessageGenerationOptions["quoted"] | undefined = undefined;
        if (quotedMessageId) {
            try {
                const dbSession = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
                if (dbSession) {
                    const quotedMsg = await prisma.message.findFirst({
                        where: { sessionId: dbSession.id, keyId: quotedMessageId },
                        select: { keyId: true, remoteJid: true, fromMe: true, content: true, senderJid: true }
                    });
                    if (quotedMsg) {
                        const rawParticipant = quotedMsg.fromMe 
                            ? instance.socket.user?.id 
                            : (quotedMsg.senderJid || quotedMsg.remoteJid);
                        
                        let cleanParticipant: string | undefined = undefined;
                        if (rawParticipant) {
                            const [userPart, domain] = rawParticipant.split('@');
                            const cleanUser = userPart.split(':')[0];
                            cleanParticipant = domain ? `${cleanUser}@${domain}` : cleanUser;
                        }

                        quotedOption = {
                            key: {
                                remoteJid: quotedMsg.remoteJid,
                                fromMe: quotedMsg.fromMe,
                                id: quotedMsg.keyId,
                                participant: cleanParticipant
                            },
                            message: {
                                conversation: quotedMsg.content || ""
                            }
                        };
                    }
                }
            } catch (e) {
                logger.error("ChatService", "Error fetching quoted message (non-fatal):", e);
            }
        }

        // A rota de envio de texto manda a mensagem como string; os demais chamadores mandam o objeto do Baileys
        let msgPayload: OutgoingPayload = typeof messagePayload === "string" ? { text: messagePayload } : { ...messagePayload };

        // Normalize "text" to "caption" if a media message is sent with "text"
        if (msgPayload.text && (msgPayload.image || msgPayload.video || msgPayload.document || msgPayload.audio)) {
            if (!msgPayload.caption) {
                msgPayload.caption = msgPayload.text;
            }
            delete msgPayload.text;
        }

        const st = msgPayload.sticker;
        const stObj = st && typeof st === "object" && !Buffer.isBuffer(st) ? st : undefined;
        const stUrl = typeof st === "string" ? st : stObj?.url;
        if (stUrl) {
            try {
                const res = await fetch(stUrl);
                if (!res.ok) throw new Error(`Falha ao baixar a figurinha`);
                const buffer = await res.arrayBuffer();
                const sticker = new Sticker(Buffer.from(buffer), {
                    pack: stObj?.pack || "Saiaê Bot",
                    author: stObj?.author || "Saiaê",
                    type: "full",
                    quality: 50
                });
                msgPayload = { sticker: await sticker.toBuffer() };
            } catch (e) {
                throw new Error(`Falha ao gerar a figurinha a partir da URL: ${errorMessage(e)}`);
            }
        }

        const midias = [["image", "a imagem"], ["video", "o vídeo"], ["document", "o documento"], ["audio", "o áudio"]] as const;
        for (const [campo, nome] of midias) {
            if (msgPayload[campo] !== undefined) msgPayload[campo] = await baixarSeUrl(msgPayload[campo], nome);
        }

        if (msgPayload.text && mentions && Array.isArray(mentions)) {
            msgPayload.mentions = mentions;
        }

        const options: MiscMessageGenerationOptions & { mentions?: string[] } = { mentions: mentions || [] };
        if (quotedOption) {
            options.quoted = quotedOption;
        }

        const sendResult = await instance.socket.sendMessage(jid, msgPayload as AnyMessageContent, options);

        // Fire webhook for sent message (non-blocking)
        try {
            const webhookMsg: Partial<WAMessage> = {
                key: sendResult?.key || sendResult || {},
                message: {
                    conversation: typeof msgPayload.text === 'string' ? msgPayload.text : (msgPayload.caption || "")
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };

            // Map media types to proper message structure for webhook
            if (msgPayload.image) {
                webhookMsg.message = {
                    imageMessage: { caption: msgPayload.caption || "", mimetype: msgPayload.mimetype || "image/jpeg" }
                };
            } else if (msgPayload.video) {
                webhookMsg.message = {
                    videoMessage: { caption: msgPayload.caption || "", mimetype: msgPayload.mimetype || "video/mp4" }
                };
            } else if (msgPayload.audio) {
                webhookMsg.message = {
                    audioMessage: { mimetype: msgPayload.ptt ? "audio/ogg; codecs=opus" : "audio/mp4" }
                };
            } else if (msgPayload.document) {
                webhookMsg.message = {
                    documentMessage: { caption: msgPayload.caption || "", fileName: msgPayload.fileName || "document", mimetype: msgPayload.mimetype || "application/octet-stream" }
                };
            } else if (msgPayload.sticker) {
                webhookMsg.message = {
                    stickerMessage: {}
                };
            }

            onMessageSent(sessionId, webhookMsg).catch(e => logger.error("ChatService", "Webhook error:", e));
        } catch (e) {
            // Non-blocking — webhook failure shouldn't break message send
        }

        return sendResult;
    }

    /**
     * Send a media message locally from a buffer.
     */
    static async sendMediaMessage(
        sessionId: string,
        jid: string,
        buffer: Buffer,
        type: string,
        mimetype: string,
        fileName: string,
        caption: string
    ) {
        const instance = waManager.getInstance(sessionId);
        if (!instance || !instance.socket) {
            throw new Error("WhatsApp session is disconnected or not found");
        }

        const messageOptions: { caption?: string; mimetype: string } = { mimetype };
        if (caption) messageOptions.caption = caption;

        let content: AnyMessageContent;

        if (type === 'image') {
            content = { image: buffer, ...messageOptions };
        } else if (type === 'video') {
            content = { video: buffer, ...messageOptions };
        } else if (type === 'audio') {
            content = { audio: buffer, mimetype: 'audio/mp4', ptt: false };
        } else if (type === 'voice') {
            content = { audio: buffer, mimetype: 'audio/mp4', ptt: true };
        } else if (type === 'document') {
            content = { document: buffer, fileName, ...messageOptions };
        } else if (type === 'sticker') {
            const sticker = new Sticker(buffer, {
                pack: "Saiaê Bot",
                author: "Saiaê",
                type: "full",
                quality: 50
            });
            content = { sticker: await sticker.toBuffer() };
        } else {
            content = { document: buffer, fileName, ...messageOptions };
        }

        const sendResult = await instance.socket.sendMessage(jid, content);

        // Fire webhook for sent media message (non-blocking)
        try {
            const webhookMsg: Partial<WAMessage> = {
                key: sendResult?.key || sendResult || {},
                message: {
                    conversation: caption || ""
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };

            // Map media type to proper message structure for webhook
            if (type === 'image') {
                webhookMsg.message = { imageMessage: { caption: caption || "", mimetype } };
            } else if (type === 'video') {
                webhookMsg.message = { videoMessage: { caption: caption || "", mimetype } };
            } else if (type === 'audio' || type === 'voice') {
                webhookMsg.message = { audioMessage: { mimetype: 'audio/mp4', ptt: type === 'voice' } };
            } else if (type === 'document') {
                webhookMsg.message = { documentMessage: { caption: caption || "", fileName, mimetype } };
            } else if (type === 'sticker') {
                webhookMsg.message = { stickerMessage: {} };
            }

            onMessageSent(sessionId, webhookMsg).catch(e => logger.error("ChatService", "Webhook error:", e));
        } catch (e) {
            // Non-blocking
        }

        return sendResult;
    }
}
