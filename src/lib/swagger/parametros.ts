// Parâmetros de caminho que se repetem em dezenas de rotas. Os que têm descrição ou exemplo próprios ficam inline.
const deCaminho = (name: string) => ({ name, in: "path", required: true, schema: { type: "string" } });

export const paramSessionId = deCaminho("sessionId");
export const paramJid = deCaminho("jid");
export const paramId = deCaminho("id");
export const paramMessageId = deCaminho("messageId");
export const paramLabelId = deCaminho("labelId");
