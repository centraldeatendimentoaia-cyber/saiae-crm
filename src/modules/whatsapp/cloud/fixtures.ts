/**
 * Payloads de exemplo do webhook da Meta para os testes. Telefones, ids e nomes são FICTÍCIOS.
 *
 * Procedência: o formato de "mensagem de texto recebida" e de status "delivered" foi conferido
 * com a página oficial de exemplos de payload da Meta em 07/10/2026. Os demais tipos (mídia,
 * localização, contatos, interativo, reação, status sent/read/failed, BSUID) seguem a referência
 * de mensagens e a documentação do BSUID, mas ainda NÃO foram conferidos contra payloads reais:
 * confirmar com o botão "Testar" do painel da Meta ou o sandbox quando a conta estiver configurada.
 */

const META = { display_phone_number: "15550001111", phone_number_id: "106540352242922" };

/** Envelopa um `value` no formato que a Meta envia. */
export const envelope = (value: Record<string, unknown>, field = "messages") => ({
    object: "whatsapp_business_account",
    entry: [{ id: "100000000000001", changes: [{ field, value: { messaging_product: "whatsapp", metadata: META, ...value } }] }],
});

const contact = { profile: { name: "Maria Teste" }, wa_id: "5561999990001" };
const base = { from: "5561999990001", id: "wamid.HBgNNTU2MTk5OTk5MDAwMRUCABIYFDNB", timestamp: "1749416383" };

export const textMessage = envelope({ contacts: [contact], messages: [{ ...base, type: "text", text: { body: "Tem açaí de 500ml?" } }] });

export const imageMessage = envelope({
    contacts: [contact],
    messages: [{ ...base, type: "image", image: { caption: "Olha esse", mime_type: "image/jpeg", sha256: "abc123", id: "5001" } }],
});

export const audioVoiceMessage = envelope({
    contacts: [contact],
    messages: [{ ...base, type: "audio", audio: { mime_type: "audio/ogg; codecs=opus", sha256: "def456", id: "5002", voice: true } }],
});

export const documentMessage = envelope({
    contacts: [contact],
    messages: [{ ...base, type: "document", document: { filename: "cardapio.pdf", caption: "segue", mime_type: "application/pdf", sha256: "ghi789", id: "5003" } }],
});

export const stickerMessage = envelope({
    contacts: [contact],
    messages: [{ ...base, type: "sticker", sticker: { mime_type: "image/webp", sha256: "jkl012", id: "5004", animated: false } }],
});

export const locationMessage = envelope({
    contacts: [contact],
    messages: [{ ...base, type: "location", location: { latitude: -15.7801, longitude: -47.9292, name: "Casa", address: "Asa Sul, Brasília" } }],
});

export const contactsMessage = envelope({
    contacts: [contact],
    messages: [{ ...base, type: "contacts", contacts: [{ name: { formatted_name: "João Amigo" }, phones: [{ phone: "+55 61 99999-0002", wa_id: "5561999990002" }] }] }],
});

export const buttonReplyMessage = envelope({
    contacts: [contact],
    messages: [{ ...base, type: "interactive", interactive: { type: "button_reply", button_reply: { id: "confirmar", title: "Confirmar" } } }],
});

export const listReplyMessage = envelope({
    contacts: [contact],
    messages: [{ ...base, type: "interactive", interactive: { type: "list_reply", list_reply: { id: "item-7", title: "Açaí 300ml", description: "R$ 16,00" } } }],
});

export const templateButtonMessage = envelope({
    contacts: [contact],
    messages: [{ ...base, type: "button", button: { payload: "avaliar-5", text: "Nota 5" } }],
});

export const reactionMessage = envelope({
    contacts: [contact],
    messages: [{ ...base, type: "reaction", reaction: { message_id: "wamid.ORIGINAL", emoji: "👍" } }],
});

export const reactionRemoved = envelope({
    contacts: [contact],
    messages: [{ ...base, type: "reaction", reaction: { message_id: "wamid.ORIGINAL" } }],
});

export const replyWithContext = envelope({
    contacts: [contact],
    messages: [{ ...base, type: "text", text: { body: "sim" }, context: { from: "15550001111", id: "wamid.CITADA", forwarded: true } }],
});

export const unsupportedMessage = envelope({
    contacts: [contact],
    messages: [{ ...base, type: "unsupported", errors: [{ code: 131051, title: "Message type is not supported", message: "Message type is not supported", error_data: { details: "Message type unknown" } }] }],
});

export const orderMessage = envelope({
    contacts: [contact],
    messages: [{ ...base, type: "order", order: { catalog_id: "1", product_items: [] } }],
});

export const adReferralMessage = envelope({
    contacts: [contact],
    messages: [{
        ...base, type: "text", text: { body: "Vi o anúncio" },
        referral: { source_url: "https://fb.me/anuncio", source_id: "120000001", source_type: "ad", ctwa_clid: "ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNpxs" },
    }],
});

// Telefone oculto: a Meta passa a identificar o cliente só pelo BSUID (user_id).
export const bsuidOnlyMessage = envelope({
    contacts: [{ profile: { name: "Cliente Oculto", username: "@cliente.oculto" }, wa_id: "BR.13491208655302741918", user_id: "BR.13491208655302741918" }],
    messages: [{ from: "BR.13491208655302741918", from_user_id: "BR.13491208655302741918", id: "wamid.BSUID", timestamp: "1749416400", type: "text", text: { body: "oi" } }],
});

// Telefone visível e BSUID juntos.
export const phoneAndBsuidMessage = envelope({
    contacts: [{ profile: { name: "Maria Teste" }, wa_id: "5561999990001", user_id: "BR.9988776655443322" }],
    messages: [{ ...base, from_user_id: "BR.9988776655443322", type: "text", text: { body: "oi" } }],
});

const statusBase = { id: "wamid.SAIDA1", recipient_id: "5561999990001", timestamp: "1750263773" };

export const statusSent = envelope({ statuses: [{ ...statusBase, status: "sent", conversation: { id: "c1", origin: { type: "service" } }, pricing: { billable: true, pricing_model: "CBP", category: "service" } }] });
export const statusDelivered = envelope({ statuses: [{ ...statusBase, status: "delivered", conversation: { id: "c1", origin: { type: "service" } }, pricing: { billable: true, pricing_model: "CBP", category: "service" } }] });
export const statusRead = envelope({ statuses: [{ ...statusBase, status: "read" }] });
export const statusFailed = envelope({
    statuses: [{ ...statusBase, status: "failed", errors: [{ code: 131047, title: "Re-engagement message", message: "Re-engagement message", error_data: { details: "Message failed to send because more than 24 hours have passed since the customer last replied to this number." } }] }],
});
export const statusBsuidRecipient = envelope({ statuses: [{ id: "wamid.SAIDA2", status: "delivered", timestamp: "1750263800", recipient_id: "BR.13491208655302741918" }] });

export const systemError = envelope({ errors: [{ code: 131000, title: "Something went wrong", message: "Something went wrong", error_data: { details: "Internal error" } }] });

/** Um POST da Meta pode juntar mensagens e status. */
export const mixedBatch = envelope({
    contacts: [contact],
    messages: [{ ...base, type: "text", text: { body: "a" } }, { ...base, id: "wamid.2", type: "text", text: { body: "b" } }],
    statuses: [{ ...statusBase, status: "read" }],
});

export const otherField = envelope({ event: "something" }, "account_update");
