import type { WASocket } from "@whiskeysockets/baileys";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { IDADE_MAX_MS, lerConteudo, telefoneDe } from "@/modules/agente-salao/agente";
import { foiEnviadaPeloCrm } from "@/modules/agente-salao/enviados";
import { pessoaAssumiu } from "@/modules/agente-salao/estado";
import { BoundedTtlMap } from "@/modules/integracao/comanda/state";
import { humanoAssumiu, tratar } from "./motor";

/**
 * Ponte do Baileys para o bot de pedidos. Só olha mensagens de sessões ligadas a uma loja (BarracaSessao) e entrega
 * ao motor uma `EntradaBot` limpa. Não decide nada: quem decide se responde é o motor (loja com bot ligado etc.).
 */

const TAG = "BotPedidos";
const CACHE_BARRACA_MS = 60_000;

export interface EntradaBot {
    sessionId: string;
    barracaId: string;
    jid: string;
    /** Telefone só com dígitos: identifica o contato nesta sessão. */
    contactKey: string;
    nome: string | null;
    texto: string;
    messageId: string;
    /** Instante da mensagem, em milissegundos. */
    timestamp: number;
}

export interface DepsEntrada {
    barracaDaSessao: (sessionId: string) => Promise<string | null>;
    tratar: (entrada: EntradaBot) => Promise<void>;
    /** Uma pessoa escreveu pelo celular/WhatsApp Web neste contato: o bot se cala. */
    humanoAssumiu: (sessionId: string, contactKey: string) => void | Promise<void>;
}

const cacheBarraca = new BoundedTtlMap<{ id: string | null }>(500, CACHE_BARRACA_MS);

const depsPadrao = (): DepsEntrada => ({
    barracaDaSessao: async (sessionId) => {
        const hit = cacheBarraca.get(sessionId);
        if (hit) return hit.id;
        const id = (await prisma.barracaSessao.findUnique({ where: { sessionId }, select: { barracaId: true } }))?.barracaId ?? null;
        cacheBarraca.set(sessionId, { id });
        return id;
    },
    tratar: async (entrada) => {
        // Resposta a um pedido de avaliação (nota 1 a 5) não vai para o bot. Import tardio: evita ciclo com o manager.
        const { tratarRespostaAvaliacao } = await import("@/modules/disparos/avaliacao");
        if (await tratarRespostaAvaliacao({ sessionId: entrada.sessionId, jid: entrada.jid, contactKey: entrada.contactKey, texto: entrada.texto })) return;
        await tratar(entrada);
    },
    humanoAssumiu: (sessionId, contactKey) => humanoAssumiu(sessionId, contactKey),
});

// Lista de sessões da Cloud API (mesma variável de provider/index.ts; não importa o provider para não criar ciclo com o manager).
const ehCloud = (sessionId: string): boolean => (process.env.WHATSAPP_CLOUD_SESSION_ID ?? "").split(",").some((s) => s.trim() === sessionId);

const jaLigado = new WeakSet<object>();

export function bindBotPedidos(sock: WASocket, sessionId: string, over: Partial<DepsEntrada> = {}): void {
    if (ehCloud(sessionId)) return; // Cloud API tem outro caminho de entrada
    if (jaLigado.has(sock)) return;
    jaLigado.add(sock);
    const deps: DepsEntrada = { ...depsPadrao(), ...over };

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        for (const msg of messages) {
            try {
                const jid = msg.key.remoteJid;
                if (!jid || !msg.message) continue;
                if (!(jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"))) continue; // grupos, status, listas e canais ficam de fora
                const telefone = telefoneDe(jid, (msg.key as { remoteJidAlt?: string }).remoteJidAlt);
                if (!telefone) continue; // sem telefone não há como anotar pedido nem identificar o cliente
                const c = lerConteudo(msg);
                if (c.ignorar) continue;
                const criadaEm = Number(msg.messageTimestamp ?? 0) * 1000 || Date.now();

                if (msg.key.fromMe) {
                    if (!(await deps.barracaDaSessao(sessionId))) continue;
                    if (pessoaAssumiu({ fromMe: true, enviadaPeloCrm: foiEnviadaPeloCrm(msg.key.id), criadaEm: new Date(criadaEm), agora: new Date(), tipoEvento: type })) {
                        await deps.humanoAssumiu(sessionId, telefone);
                    }
                    continue;
                }

                if (type !== "notify") continue;
                if (!c.texto || !msg.key.id) continue; // áudio e mídia sem legenda: o bot não atende
                if (Date.now() - criadaEm > IDADE_MAX_MS) continue;
                const barracaId = await deps.barracaDaSessao(sessionId);
                if (!barracaId) continue;
                await deps.tratar({ sessionId, barracaId, jid, contactKey: telefone, nome: msg.pushName?.trim() || null, texto: c.texto, messageId: msg.key.id, timestamp: criadaEm });
            } catch (e) {
                logger.warn(TAG, `falha ao tratar mensagem: ${(e as { name?: string })?.name ?? "erro"}`);
            }
        }
    });
}
