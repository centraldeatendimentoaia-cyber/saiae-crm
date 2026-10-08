/**
 * Normaliza o corpo do webhook da WhatsApp Cloud API (Meta) para um formato interno único.
 *
 * Só leitura e transformação: não grava nada, não loga e não envia nada. É a base de entrada
 * do CloudApiProvider (SAI-003). Tolerante por desenho: campo desconhecido é ignorado, item
 * malformado é contado em `ignored` e nunca derruba o lote, e nada é mutado.
 *
 * Identidade do cliente: a Meta está introduzindo o BSUID (`user_id`, business-scoped user ID) e
 * nomes de usuário; o telefone pode vir oculto. Por isso `identity` guarda telefone E BSUID, e
 * `contactKey` usa o telefone quando existe e o BSUID quando não existe.
 */

export type InboundMessageType =
    | "text"
    | "image"
    | "video"
    | "audio"
    | "voice"
    | "document"
    | "sticker"
    | "location"
    | "contacts"
    | "button_reply"
    | "list_reply"
    | "reaction"
    | "unsupported";

export interface ContactIdentity {
    /** Telefone só com dígitos (wa_id), ou null se a Meta o ocultou. */
    phone: string | null;
    /** BSUID (ex.: "BR.13491208655302741918"), ou null se a Meta não enviou. */
    userId: string | null;
    username: string | null;
    /** Nome do perfil do WhatsApp (digitado pelo cliente: tratar como dado pessoal e não confiável). */
    name: string | null;
    /** Chave estável para agrupar a conversa: telefone, senão BSUID. */
    contactKey: string;
}

export interface InboundMedia {
    id: string;
    mimeType: string | null;
    sha256: string | null;
    fileName: string | null;
}

export interface InboundMessage {
    kind: "message";
    provider: "cloud-api";
    messageId: string;
    /** Número da loja que recebeu (phone_number_id da Meta): identifica de qual sessão/barraca veio. */
    phoneNumberId: string | null;
    displayPhone: string | null;
    timestamp: Date;
    type: InboundMessageType;
    /** Tipo bruto da Meta (útil quando type = "unsupported"). */
    rawType: string;
    from: ContactIdentity;
    /** Texto, legenda da mídia ou título da opção escolhida. */
    text: string | null;
    media: InboundMedia | null;
    location: { latitude: number; longitude: number; name: string | null; address: string | null } | null;
    contacts: { name: string | null; phones: string[] }[];
    /** id da opção escolhida (botão ou lista). */
    replyId: string | null;
    reaction: { messageId: string; emoji: string | null } | null;
    /** id da mensagem citada, se o cliente respondeu a uma. */
    replyToMessageId: string | null;
    forwarded: boolean;
    /** Origem de anúncio (click-to-WhatsApp), se houver. Útil para atribuição de campanha. */
    referral: { sourceUrl: string | null; sourceId: string | null; sourceType: string | null; ctwaClid: string | null } | null;
    /** Erros que a Meta anexa (ex.: tipo não suportado). */
    errors: ProviderError[];
}

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

export interface StatusUpdate {
    kind: "status";
    provider: "cloud-api";
    messageId: string;
    phoneNumberId: string | null;
    status: DeliveryStatus;
    timestamp: Date;
    recipient: Pick<ContactIdentity, "phone" | "userId" | "contactKey">;
    /** Só em status "failed". */
    error: ProviderError | null;
    /** Dados de cobrança da Meta (categoria da conversa/mensagem), quando enviados. */
    billing: { category: string | null; billable: boolean | null } | null;
}

export interface SystemError {
    kind: "error";
    provider: "cloud-api";
    phoneNumberId: string | null;
    error: ProviderError;
}

export interface ProviderError {
    code: number | null;
    title: string | null;
    message: string | null;
    details: string | null;
}

export type InboundEvent = InboundMessage | StatusUpdate | SystemError;

export interface NormalizedBatch {
    events: InboundEvent[];
    /** Itens descartados: campo diferente de "messages", status desconhecido, item malformado. */
    ignored: number;
}

// ---------------------------------------------------------------- utilidades defensivas

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function num(v: unknown): number | null {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
    return null;
}

/** Segundos desde 1970 (string ou número) → Date; sem valor válido usa agora. */
function toDate(v: unknown): Date {
    const n = num(v);
    return n !== null ? new Date(n * 1000) : new Date();
}

/** BSUID: país ISO (2 letras) + ponto + até 128 alfanuméricos. */
const BSUID_RE = /^[A-Za-z]{2}\.[A-Za-z0-9]{1,128}$/;
const PHONE_RE = /^\d{5,20}$/;

function classifyId(raw: unknown): { phone: string | null; userId: string | null } {
    const s = str(raw);
    if (!s) return { phone: null, userId: null };
    if (BSUID_RE.test(s)) return { phone: null, userId: s };
    const digits = s.replace(/\D/g, "");
    return PHONE_RE.test(digits) ? { phone: digits, userId: null } : { phone: null, userId: null };
}

function identityOf(waId: unknown, userId: unknown, profile: Obj | null, username: unknown): ContactIdentity | null {
    const a = classifyId(waId);
    const b = classifyId(userId);
    const phone = a.phone ?? b.phone;
    const bsuid = b.userId ?? a.userId;
    const contactKey = phone ?? bsuid;
    if (!contactKey) return null;
    return {
        phone,
        userId: bsuid,
        username: str(username) ?? (profile ? str(profile.username) : null),
        name: profile ? str(profile.name) : null,
        contactKey,
    };
}

function errorOf(raw: unknown): ProviderError | null {
    if (!isObj(raw)) return null;
    const data = isObj(raw.error_data) ? raw.error_data : null;
    return {
        code: num(raw.code),
        title: str(raw.title),
        message: str(raw.message),
        details: data ? str(data.details) : null,
    };
}

function errorsOf(raw: unknown): ProviderError[] {
    return arr(raw).map(errorOf).filter((e): e is ProviderError => e !== null);
}

// ---------------------------------------------------------------- mensagens

const MEDIA_TYPES = new Set(["image", "video", "audio", "document", "sticker"]);

function mediaOf(m: Obj, rawType: string): InboundMedia | null {
    const body = m[rawType];
    if (!isObj(body)) return null;
    const id = str(body.id);
    if (!id) return null;
    return { id, mimeType: str(body.mime_type), sha256: str(body.sha256), fileName: str(body.filename) };
}

function normalizeMessage(
    m: Obj,
    meta: { phoneNumberId: string | null; displayPhone: string | null },
    contacts: Obj[]
): InboundMessage | null {
    const messageId = str(m.id);
    const rawType = str(m.type);
    if (!messageId || !rawType) return null;

    // Telefone/BSUID de quem escreveu, com o nome do perfil quando a Meta o enviou em `contacts`.
    // Compara só valores presentes: null === null não pode casar com o contato errado.
    const same = (a: string | null, b: string | null) => a !== null && a === b;
    const fromId = str(m.from);
    const fromUserId = str(m.from_user_id);
    const profileEntry =
        contacts.find(
            (c) =>
                same(str(c.wa_id), fromId) ||
                same(str(c.user_id), fromUserId) ||
                same(str(c.wa_id), fromUserId) ||
                same(str(c.user_id), fromId)
        ) ??
        (contacts.length === 1 ? contacts[0] : null); // com vários contatos e nenhum casando, não arrisca o nome de outra pessoa
    const profile = profileEntry && isObj(profileEntry.profile) ? profileEntry.profile : null;
    const from = identityOf(m.from, m.from_user_id ?? profileEntry?.user_id, profile, profileEntry?.username);
    if (!from) return null;

    const base: InboundMessage = {
        kind: "message",
        provider: "cloud-api",
        messageId,
        phoneNumberId: meta.phoneNumberId,
        displayPhone: meta.displayPhone,
        timestamp: toDate(m.timestamp),
        type: "unsupported",
        rawType,
        from,
        text: null,
        media: null,
        location: null,
        contacts: [],
        replyId: null,
        reaction: null,
        replyToMessageId: isObj(m.context) ? str(m.context.id) : null,
        forwarded: isObj(m.context) && m.context.forwarded === true,
        referral: null,
        errors: errorsOf(m.errors),
    };

    if (isObj(m.referral)) {
        base.referral = {
            sourceUrl: str(m.referral.source_url),
            sourceId: str(m.referral.source_id),
            sourceType: str(m.referral.source_type),
            ctwaClid: str(m.referral.ctwa_clid),
        };
    }

    if (rawType === "text") {
        base.type = "text";
        base.text = isObj(m.text) ? str(m.text.body) : null;
    } else if (MEDIA_TYPES.has(rawType)) {
        const body = isObj(m[rawType]) ? (m[rawType] as Obj) : null;
        base.type = rawType === "audio" && body?.voice === true ? "voice" : (rawType as InboundMessageType);
        base.media = mediaOf(m, rawType);
        base.text = body ? str(body.caption) : null;
    } else if (rawType === "location" && isObj(m.location)) {
        const lat = num(m.location.latitude);
        const lng = num(m.location.longitude);
        if (lat !== null && lng !== null) {
            base.type = "location";
            base.location = { latitude: lat, longitude: lng, name: str(m.location.name), address: str(m.location.address) };
        }
    } else if (rawType === "contacts") {
        base.type = "contacts";
        base.contacts = arr(m.contacts)
            .filter(isObj)
            .map((c) => ({
                name: isObj(c.name) ? str(c.name.formatted_name) : null,
                phones: arr(c.phones).filter(isObj).map((p) => str(p.wa_id) ?? str(p.phone)).filter((p): p is string => !!p),
            }));
    } else if (rawType === "interactive" && isObj(m.interactive)) {
        const i = m.interactive;
        if (i.type === "button_reply" && isObj(i.button_reply)) {
            base.type = "button_reply";
            base.replyId = str(i.button_reply.id);
            base.text = str(i.button_reply.title);
        } else if (i.type === "list_reply" && isObj(i.list_reply)) {
            base.type = "list_reply";
            base.replyId = str(i.list_reply.id);
            base.text = str(i.list_reply.title);
        }
    } else if (rawType === "button" && isObj(m.button)) {
        // botão de resposta rápida de template
        base.type = "button_reply";
        base.replyId = str(m.button.payload);
        base.text = str(m.button.text);
    } else if (rawType === "reaction" && isObj(m.reaction)) {
        const target = str(m.reaction.message_id);
        if (target) {
            base.type = "reaction";
            base.reaction = { messageId: target, emoji: str(m.reaction.emoji) }; // emoji ausente = reação removida
        }
    }

    return base;
}

// ---------------------------------------------------------------- status

const STATUSES = new Set<DeliveryStatus>(["sent", "delivered", "read", "failed"]);

function normalizeStatus(s: Obj, meta: { phoneNumberId: string | null }): StatusUpdate | null {
    const messageId = str(s.id);
    const status = str(s.status) as DeliveryStatus | null;
    if (!messageId || !status || !STATUSES.has(status)) return null;
    const id = identityOf(s.recipient_id, s.recipient_user_id, null, null);
    if (!id) return null;

    const pricing = isObj(s.pricing) ? s.pricing : null;
    const conversation = isObj(s.conversation) ? s.conversation : null;
    const origin = conversation && isObj(conversation.origin) ? conversation.origin : null;
    const category = (pricing ? str(pricing.category) : null) ?? (origin ? str(origin.type) : null);
    const billable = pricing && typeof pricing.billable === "boolean" ? pricing.billable : null;

    return {
        kind: "status",
        provider: "cloud-api",
        messageId,
        phoneNumberId: meta.phoneNumberId,
        status,
        timestamp: toDate(s.timestamp),
        recipient: { phone: id.phone, userId: id.userId, contactKey: id.contactKey },
        error: status === "failed" ? errorsOf(s.errors)[0] ?? { code: null, title: null, message: null, details: null } : null,
        billing: category !== null || billable !== null ? { category, billable } : null,
    };
}

// ---------------------------------------------------------------- entrada

/** Converte o corpo bruto (já em JSON) de um POST da Meta em eventos internos. */
export function normalizeMetaWebhook(payload: unknown): NormalizedBatch {
    const batch: NormalizedBatch = { events: [], ignored: 0 };
    if (!isObj(payload) || payload.object !== "whatsapp_business_account") {
        batch.ignored += 1;
        return batch;
    }

    for (const entry of arr(payload.entry)) {
        if (!isObj(entry)) {
            batch.ignored += 1;
            continue;
        }
        for (const change of arr(entry.changes)) {
            if (!isObj(change) || change.field !== "messages" || !isObj(change.value)) {
                batch.ignored += 1;
                continue;
            }
            const value = change.value;
            const metadata = isObj(value.metadata) ? value.metadata : {};
            const meta = { phoneNumberId: str(metadata.phone_number_id), displayPhone: str(metadata.display_phone_number) };
            const contacts = arr(value.contacts).filter(isObj);

            for (const m of arr(value.messages)) {
                const ev = isObj(m) ? normalizeMessage(m, meta, contacts) : null;
                if (ev) batch.events.push(ev);
                else batch.ignored += 1;
            }
            for (const s of arr(value.statuses)) {
                const ev = isObj(s) ? normalizeStatus(s, meta) : null;
                if (ev) batch.events.push(ev);
                else batch.ignored += 1;
            }
            for (const e of errorsOf(value.errors)) {
                batch.events.push({ kind: "error", provider: "cloud-api", phoneNumberId: meta.phoneNumberId, error: e });
            }
        }
    }
    return batch;
}
