/**
 * Resolve o endereço real (JID) de um número antes de enviar.
 * Corrige o caso comum dos celulares brasileiros: o WhatsApp pode ter o número cadastrado
 * com ou sem o 9º dígito, e mandar para o formato errado "envia" mas a mensagem nunca chega.
 * Grupos, canais e outros tipos de JID passam direto.
 */
export async function resolveSendJid(socket: any, jid: string): Promise<string> {
    if (!jid.endsWith("@s.whatsapp.net")) return jid;
    const found = await socket.onWhatsApp(jid.split("@")[0].split(":")[0]);
    if (!found?.[0]?.exists) throw new Error("Número não possui WhatsApp");
    return found[0].jid as string;
}
