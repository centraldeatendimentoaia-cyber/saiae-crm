import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Sessão ligada a uma barraca do Sai aê (BarracaSessao) é atendida pelo bot de pedidos: o atendente de IA do salão/clínica
 * não pode responder nela, senão os dois bots falariam com o mesmo cliente. Cache curto para não ir ao banco a cada mensagem.
 */
const CACHE_MS = 20_000;
const cache = new Map<string, { em: number; barraca: boolean }>();

export const MSG_SESSAO_DE_BARRACA = "Este número está ligado a um restaurante do Sai aê; o atendente de IA não pode ser ativado nele.";

export function limparCacheBarraca(sessionId?: string): void {
    if (sessionId) cache.delete(sessionId);
    else cache.clear();
}

/** true quando a sessão (string do Baileys) está em BarracaSessao. Se o banco falhar, não bloqueia (comportamento anterior). */
export async function sessaoEhDeBarraca(sessionId: string): Promise<boolean> {
    const hit = cache.get(sessionId);
    if (hit && Date.now() - hit.em < CACHE_MS) return hit.barraca;
    try {
        const r = await prisma.barracaSessao.findUnique({ where: { sessionId }, select: { id: true } });
        const barraca = !!r;
        cache.set(sessionId, { em: Date.now(), barraca });
        return barraca;
    } catch (e) {
        logger.warn("AgenteSalao", `não consegui checar BarracaSessao: ${(e as { name?: string })?.name ?? "erro"}`);
        return false;
    }
}
