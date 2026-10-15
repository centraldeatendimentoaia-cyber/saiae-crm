import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import { logger } from "./logger";

// Identifica esta instância do processo; trava só é liberada/renovada por quem a pegou.
const HOLDER = randomUUID();

/** Tenta pegar a trava `name`. Verdadeiro só se ninguém a segura (ou se a anterior expirou). */
export async function acquireJobLock(name: string, ttlMs: number): Promise<boolean> {
    const expiresAt = new Date(Date.now() + ttlMs);
    try {
        await prisma.jobLock.create({ data: { name, holder: HOLDER, expiresAt } });
        return true;
    } catch (e) {
        if ((e as { code?: string })?.code !== "P2002") {
            logger.warn("JobLock", `falha ao pegar a trava ${name}: ${(e as Error)?.message ?? "erro"}`);
            return false; // na dúvida não executa: melhor pular uma rodada que duplicar envio
        }
    }
    // Já existe a linha: só toma se estiver expirada (UPDATE condicional é atômico).
    try {
        const r = await prisma.jobLock.updateMany({
            where: { name, expiresAt: { lt: new Date() } },
            data: { holder: HOLDER, expiresAt },
        });
        return r.count === 1;
    } catch (e) {
        logger.warn("JobLock", `falha ao tomar a trava ${name}: ${(e as Error)?.message ?? "erro"}`);
        return false;
    }
}

/**
 * Executa `fn` só se esta instância conseguir a trava `name`; caso contrário retorna undefined.
 * A trava é renovada enquanto `fn` roda (rodadas longas não perdem a trava) e liberada no fim.
 * Se o processo morrer, a trava expira em `ttlMs`.
 */
export async function withJobLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined> {
    if (!(await acquireJobLock(name, ttlMs))) return undefined;
    const beat = setInterval(() => {
        prisma.jobLock
            .updateMany({ where: { name, holder: HOLDER }, data: { expiresAt: new Date(Date.now() + ttlMs) } })
            .catch(() => {});
    }, Math.max(1000, Math.floor(ttlMs / 3)));
    beat.unref?.();
    try {
        return await fn();
    } finally {
        clearInterval(beat);
        await prisma.jobLock.deleteMany({ where: { name, holder: HOLDER } }).catch(() => {});
    }
}
