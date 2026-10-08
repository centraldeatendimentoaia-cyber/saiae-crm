import { logger as defaultLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { normalizeBrPhone } from "@/modules/integracao/comanda/order-notifier";
import { SEM_LOJA } from "./store";

/**
 * Direito de apagar: quando o cliente apaga os dados na Comanda (`cliente_apagar_dados`), a Comanda chama a rota
 * `ia-apagar-conversas` e o CRM remove as conversas da IA daquele telefone naquela loja (as mensagens saem junto, em
 * cascata) e também a conversa "sem loja" do mesmo telefone, que só guarda marcadores. Idempotente. Nunca registra o telefone.
 */

/** Formas em que o WhatsApp pode entregar o mesmo número brasileiro: com e sem o 9º dígito. */
export function variantesDoTelefone(telefone: string): string[] | null {
    const n = normalizeBrPhone(telefone);
    if (!n || !n.startsWith("55")) return null;
    const ddd = n.slice(2, 4);
    const local = n.slice(4);
    const com9 = local.length === 8 ? `55${ddd}9${local}` : n;
    const sem9 = local.length === 9 && local.startsWith("9") ? `55${ddd}${local.slice(1)}` : n;
    return [...new Set([n, com9, sem9])];
}

export interface ApagarDeps {
    apagar: (lojas: string[], contactKeys: string[]) => Promise<number>;
    /** Apaga TODAS as conversas de uma loja (exclusão de conta). */
    apagarLoja: (lojaCodigo: string) => Promise<number>;
    logger: { info: (tag: string, msg: string) => void };
}

const prismaApagar: ApagarDeps["apagar"] = async (lojas, contactKeys) => {
    const r = await prisma.iaConversa.deleteMany({ where: { lojaCodigo: { in: lojas }, contactKey: { in: contactKeys } } });
    return r.count;
};

const prismaApagarLoja: ApagarDeps["apagarLoja"] = async (lojaCodigo) => {
    const r = await prisma.iaConversa.deleteMany({ where: { lojaCodigo } });
    return r.count;
};

/** Exclusão de conta da loja: apaga todas as conversas da IA daquela loja (inclusive de quem nunca pediu na Comanda). */
export async function apagarConversasDaLoja(lojaCodigo: string, over: Partial<ApagarDeps> = {}): Promise<number> {
    const deps: ApagarDeps = { apagar: prismaApagar, apagarLoja: prismaApagarLoja, logger: defaultLogger, ...over };
    const n = await deps.apagarLoja(lojaCodigo);
    deps.logger.info("IaApagar", `conversas da loja apagadas: ${n}`);
    return n;
}

/** Devolve quantas conversas foram apagadas, ou null se o telefone não é válido. */
export async function apagarConversasDoCliente(lojaCodigo: string, telefone: string, over: Partial<ApagarDeps> = {}): Promise<number | null> {
    const deps: ApagarDeps = { apagar: prismaApagar, apagarLoja: prismaApagarLoja, logger: defaultLogger, ...over };
    const chaves = variantesDoTelefone(telefone);
    if (!chaves) return null;
    const n = await deps.apagar([lojaCodigo, SEM_LOJA], chaves);
    deps.logger.info("IaApagar", `conversas apagadas: ${n}`);
    return n;
}
