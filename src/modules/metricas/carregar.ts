import { prisma } from "@/lib/prisma";
import type { MsgMetrica, OrigemResposta } from "./calcular";

const LOTE_MENSAGENS = 5000;
const LOTE_ORIGENS = 1000;

/**
 * Data a partir da qual "mensagem nossa sem registro de origem" quer dizer "pessoa no celular". Antes disso a tabela de origens
 * ainda não existia e não dá para saber. Padrão: a linha mais antiga de MensagemOrigem. METRICAS_ORIGEM_DESDE (AAAA-MM-DD) força
 * a data, útil numa clínica que mede a semana "antes" com a IA desligada (nada do CRM é enviado, então a tabela ainda está vazia).
 */
export async function origemConhecidaDesde(): Promise<Date | null> {
    const env = process.env.METRICAS_ORIGEM_DESDE?.trim();
    if (env && /^\d{4}-\d{2}-\d{2}$/.test(env)) {
        const d = new Date(`${env}T00:00:00.000-03:00`);
        if (!Number.isNaN(d.getTime())) return d;
    }
    const primeira = await prisma.mensagemOrigem.findFirst({ orderBy: { criadoEm: "asc" }, select: { criadoEm: true } });
    return primeira?.criadoEm ?? null;
}

/**
 * Mensagens da sessão entre `desde` e `ate`, só com o que as métricas precisam (nada de conteúdo nem telefone além do id do chat,
 * que não sai da API). `dbSessionId` é o Session.id (cuid); `sessionId`, a string do Baileys (chave de MensagemOrigem).
 */
export async function carregarMensagens(args: { dbSessionId: string; sessionId: string; desde: Date; ate: Date }): Promise<MsgMetrica[]> {
    const { dbSessionId, sessionId, desde, ate } = args;
    const brutas: { remoteJid: string; fromMe: boolean; timestamp: Date; keyId: string }[] = [];
    let cursor: string | undefined;
    for (;;) {
        const lote = await prisma.message.findMany({
            where: { sessionId: dbSessionId, timestamp: { gte: desde, lte: ate } },
            select: { id: true, remoteJid: true, fromMe: true, timestamp: true, keyId: true },
            orderBy: { id: "asc" },
            take: LOTE_MENSAGENS,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const m of lote) brutas.push(m);
        if (lote.length < LOTE_MENSAGENS) break;
        cursor = lote[lote.length - 1].id;
    }

    // origem só importa para o que saiu do número
    const origemPorKey = new Map<string, string>();
    const chaves = brutas.filter((m) => m.fromMe).map((m) => m.keyId);
    for (let i = 0; i < chaves.length; i += LOTE_ORIGENS) {
        const rows = await prisma.mensagemOrigem.findMany({
            where: { sessionId, keyId: { in: chaves.slice(i, i + LOTE_ORIGENS) } },
            select: { keyId: true, origem: true },
        });
        for (const r of rows) origemPorKey.set(r.keyId, r.origem);
    }

    const desdeOrigem = await origemConhecidaDesde();
    return brutas.map((m) => ({
        contato: m.remoteJid,
        fromMe: m.fromMe,
        timestamp: m.timestamp,
        origem: m.fromMe ? origemDe(origemPorKey.get(m.keyId), m.timestamp, desdeOrigem) : "desconhecido",
    }));
}

export function origemDe(registrada: string | undefined, quando: Date, desde: Date | null): OrigemResposta {
    if (registrada === "ia" || registrada === "crm") return registrada;
    return desde && quando >= desde ? "humano" : "desconhecido";
}
