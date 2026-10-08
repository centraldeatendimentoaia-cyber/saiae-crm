import { prisma } from "@/lib/prisma";
import type { WindowStore } from "@/modules/whatsapp/cloud/window";

/**
 * Armazenamento da conversa da IA (tabelas IaConversa e IaMensagem). Retenção máxima de 30 dias.
 * Nada aqui escreve em log: o chamador decide o que registrar (só contagens, nunca conteúdo).
 */

export const RETENCAO_DIAS = 30;

/**
 * Conversa "sem loja": mensagens de quem ainda não usou o link da loja. Existe só para a mensagem recebida ficar
 * registrada e abrir a janela de 24 h (a Cloud API só aceita resposta em texto livre dentro dela). Nunca é uma loja real.
 */
export const SEM_LOJA = "SEM-LOJA";

export interface ConversaRef {
    id: string;
    lojaCodigo: string;
    contactKey: string;
    estado: string; // ia | humano
    pausadaAte: Date | null;
}

export interface RegistroMensagem {
    lojaCodigo: string;
    contactKey: string;
    providerMessageId: string;
    texto: string;
    direcao: "in" | "out";
    em: Date;
}

/** O que o consumidor precisa do armazenamento (injetável nos testes). */
export interface IaStore {
    /** Grava a mensagem. `novo = false` se o `providerMessageId` já existia (reentrega da Meta). */
    registrarMensagem(r: RegistroMensagem): Promise<{ novo: boolean; conversa: ConversaRef }>;
    /** Loja da conversa mais recente deste cliente, ou null se ele nunca falou com a IA. */
    lojaDaConversa(contactKey: string): Promise<string | null>;
    /** Últimas mensagens da conversa em ordem cronológica. */
    historico(conversaId: string, limite: number): Promise<{ direcao: "in" | "out"; texto: string }[]>;
}

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === "P2002";

export const prismaStore: IaStore = {
    async registrarMensagem(r) {
        const existente = await prisma.iaMensagem.findUnique({ where: { providerMessageId: r.providerMessageId }, select: { conversa: true } });
        if (existente) return { novo: false, conversa: toRef(existente.conversa) };

        const conversa = await prisma.iaConversa.upsert({
            where: { lojaCodigo_contactKey: { lojaCodigo: r.lojaCodigo, contactKey: r.contactKey } },
            create: { lojaCodigo: r.lojaCodigo, contactKey: r.contactKey, ultimaMensagemEm: r.em },
            update: {},
        });
        try {
            await prisma.iaMensagem.create({
                data: { conversaId: conversa.id, providerMessageId: r.providerMessageId, direcao: r.direcao, texto: r.texto, criadoEm: r.em },
            });
        } catch (e) {
            if (isUniqueViolation(e)) return { novo: false, conversa: toRef(conversa) }; // corrida: outra entrega gravou primeiro
            throw e;
        }
        if (r.direcao === "in" && r.em > conversa.ultimaMensagemEm) {
            await prisma.iaConversa.update({ where: { id: conversa.id }, data: { ultimaMensagemEm: r.em } });
        }
        return { novo: true, conversa: toRef(conversa) };
    },

    async lojaDaConversa(contactKey) {
        const c = await prisma.iaConversa.findFirst({ where: { contactKey, lojaCodigo: { not: SEM_LOJA } }, orderBy: { ultimaMensagemEm: "desc" }, select: { lojaCodigo: true } });
        return c?.lojaCodigo ?? null;
    },

    async historico(conversaId, limite) {
        const rows = await prisma.iaMensagem.findMany({ where: { conversaId }, orderBy: { criadoEm: "desc" }, take: limite, select: { direcao: true, texto: true } });
        return rows.reverse().map((m) => ({ direcao: m.direcao === "out" ? "out" : "in", texto: m.texto }));
    },
};

function toRef(c: { id: string; lojaCodigo: string; contactKey: string; estado: string; pausadaAte: Date | null }): ConversaRef {
    return { id: c.id, lojaCodigo: c.lojaCodigo, contactKey: c.contactKey, estado: c.estado, pausadaAte: c.pausadaAte };
}

/**
 * Janela de 24 h da Cloud API para a IA: a última mensagem RECEBIDA do cliente (de qualquer loja), lida das
 * mensagens que o próprio consumidor grava ANTES de responder. Substitui o ClosedWindowStore do piloto só
 * para a IA; os avisos de pedido continuam usando template.
 */
export class IaWindowStore implements WindowStore {
    async lastInboundAt(_sessionId: string, contactKey: string): Promise<Date | null> {
        const m = await prisma.iaMensagem.findFirst({
            where: { direcao: "in", conversa: { contactKey } },
            orderBy: { criadoEm: "desc" },
            select: { criadoEm: true },
        });
        return m?.criadoEm ?? null;
    }
}

/** Apaga mensagens com mais de `dias` dias (retenção de 30 dias). Devolve quantas. */
export async function limparMensagensAntigas(dias: number = RETENCAO_DIAS, agora: Date = new Date()): Promise<number> {
    const corte = new Date(agora.getTime() - dias * 86_400_000);
    const r = await prisma.iaMensagem.deleteMany({ where: { criadoEm: { lt: corte } } });
    return r.count;
}
