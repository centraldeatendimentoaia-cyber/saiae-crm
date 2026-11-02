import { jidCanonico } from "@/lib/jid-utils";

/** Última mensagem de um JID, como vem do banco. */
export interface LinhaConversa {
    remoteJid: string;
    content: string | null;
    timestamp: Date;
    type: string;
}

export interface ConversaJuntada {
    /** JID canônico (telefone quando se conhece). */
    jid: string;
    /** Todos os JIDs da mesma pessoa que têm mensagens (telefone e LID). */
    jids: string[];
    ultima: LinhaConversa;
}

/**
 * Junta as linhas de JIDs equivalentes numa só conversa: a mais recente vence como "última mensagem".
 * `classes` vem de agruparJidsEquivalentes. O resultado sai da mais recente para a mais antiga.
 */
export function juntarConversas(linhas: LinhaConversa[], classes: Map<string, Set<string>>): ConversaJuntada[] {
    const porChave = new Map<string, ConversaJuntada>();
    for (const l of linhas) {
        const classe = classes.get(l.remoteJid);
        const jid = classe ? jidCanonico(classe) : l.remoteJid;
        const atual = porChave.get(jid);
        if (!atual) {
            porChave.set(jid, { jid, jids: [l.remoteJid], ultima: l });
            continue;
        }
        if (!atual.jids.includes(l.remoteJid)) atual.jids.push(l.remoteJid);
        if (l.timestamp > atual.ultima.timestamp) atual.ultima = l;
    }
    return [...porChave.values()].sort((a, b) => b.ultima.timestamp.getTime() - a.ultima.timestamp.getTime());
}
