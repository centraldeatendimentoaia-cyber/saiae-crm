import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import { logger } from "./logger";

// Identifica esta instância do processo (presença). Cada aquisição de trava usa ainda um token próprio (ver tentarPegar).
const HOLDER = randomUUID();

/** O banco falhou ao pegar a trava (diferente de a trava estar ocupada por outra instância). */
export class JobLockDbError extends Error {
    constructor(name: string) {
        super(`banco indisponível ao pegar a trava ${name}`);
        this.name = "JobLockDbError";
    }
}

type Tentativa = "ok" | "busy" | "error";

/** Posse de uma trava em andamento: quem faz efeito externo (envio) consulta antes de cada um e para se perdeu. */
export interface PosseTrava {
    /** Dispara quando a posse se perde (outra instância tomou a trava ou a renovação não é confirmada há um TTL). */
    signal: AbortSignal;
    /** Verdadeiro só enquanto a posse está garantida: não abortada e dentro do prazo da última renovação confirmada. */
    ativa(): boolean;
}
export type LiberarTrava = (() => Promise<void>) & PosseTrava;

// O token é por aquisição: se a trava é retomada pela mesma instância, a posse antiga não "revive".
async function tentarPegar(name: string, ttlMs: number, token: string, inicio = Date.now()): Promise<Tentativa> {
    const expiresAt = new Date(inicio + ttlMs);
    try {
        await prisma.jobLock.create({ data: { name, holder: token, expiresAt } });
        return "ok";
    } catch (e) {
        if ((e as { code?: string })?.code !== "P2002") {
            logger.warn("JobLock", `falha ao pegar a trava ${name}: ${(e as Error)?.message ?? "erro"}`);
            return "error"; // na dúvida não executa: melhor pular uma rodada que duplicar envio
        }
    }
    // Já existe a linha: só toma se estiver expirada (UPDATE condicional é atômico).
    try {
        const r = await prisma.jobLock.updateMany({
            where: { name, expiresAt: { lt: new Date() } },
            data: { holder: token, expiresAt },
        });
        return r.count === 1 ? "ok" : "busy";
    } catch (e) {
        logger.warn("JobLock", `falha ao tomar a trava ${name}: ${(e as Error)?.message ?? "erro"}`);
        return "error";
    }
}

/** Tenta pegar a trava `name`. Verdadeiro só se ninguém a segura (ou se a anterior expirou). */
export async function acquireJobLock(name: string, ttlMs: number): Promise<boolean> {
    return (await tentarPegar(name, ttlMs, randomUUID())) === "ok";
}

/**
 * Executa `fn` só se esta instância conseguir a trava `name`; caso contrário retorna undefined.
 * A trava é renovada enquanto `fn` roda (rodadas longas não perdem a trava) e liberada no fim.
 * Se o processo morrer, a trava expira em `ttlMs`.
 */
export async function withJobLock<T>(name: string, ttlMs: number, fn: (posse: PosseTrava) => Promise<T>): Promise<T | undefined> {
    const release = await startJobLock(name, ttlMs);
    if (!release) return undefined;
    try {
        return await fn(release);
    } finally {
        await release();
    }
}

/**
 * Pega a trava `name` e a mantém renovada até chamar a função devolvida (para trabalho que continua depois de a
 * função que o iniciou retornar, como o disparo manual em segundo plano). Devolve null se outra instância a segura.
 */
export async function startJobLock(name: string, ttlMs: number, opts: { throwOnDbError?: boolean } = {}): Promise<LiberarTrava | null> {
    const token = randomUUID();
    const inicio = Date.now(); // mesmo instante que define expiresAt no banco: ativa() nunca passa do vencimento real
    const t = await tentarPegar(name, ttlMs, token, inicio);
    if (t === "error" && opts.throwOnDbError) throw new JobLockDbError(name);
    if (t !== "ok") return null;
    const ctrl = new AbortController();
    let validoAte = inicio + ttlMs;
    const perder = (motivo: string) => {
        if (ctrl.signal.aborted) return;
        logger.error("JobLock", `posse da trava ${name} perdida: ${motivo}`);
        ctrl.abort();
    };
    const beat = setInterval(() => {
        const enviadoEm = Date.now();
        prisma.jobLock
            .updateMany({ where: { name, holder: token }, data: { expiresAt: new Date(enviadoEm + ttlMs) } })
            .then((r) => {
                if (r.count === 0) return perder("outra instância tomou a trava");
                validoAte = enviadoEm + ttlMs;
            })
            .catch((e) => {
                logger.warn("JobLock", `falha ao renovar a trava ${name}: ${(e as Error)?.message ?? "erro"}`);
                if (Date.now() >= validoAte) perder("renovação não confirmada dentro do prazo");
            });
    }, Math.max(1000, Math.floor(ttlMs / 3)));
    beat.unref?.();
    const liberar = async () => {
        clearInterval(beat);
        await prisma.jobLock.deleteMany({ where: { name, holder: token } }).catch(() => {});
    };
    return Object.assign(liberar, {
        signal: ctrl.signal,
        ativa: () => {
            if (!ctrl.signal.aborted && Date.now() >= validoAte) perder("prazo da trava vencido sem renovação confirmada");
            return !ctrl.signal.aborted;
        },
    });
}

const PRESENCA_PREFIXO = "instancia:";
const PRESENCA_TTL_MS = 90_000;
let presenca: ReturnType<typeof setInterval> | null = null;

/** Marca esta instância como viva (linha renovada a cada 30 s; expira sozinha se o processo morrer). Idempotente. */
export function registrarInstancia(): void {
    if (presenca) return;
    const name = `${PRESENCA_PREFIXO}${HOLDER}`;
    const bater = () => {
        const expiresAt = new Date(Date.now() + PRESENCA_TTL_MS);
        prisma.jobLock.upsert({ where: { name }, create: { name, holder: HOLDER, expiresAt }, update: { expiresAt } }).catch(() => {});
    };
    bater();
    presenca = setInterval(bater, PRESENCA_TTL_MS / 3);
    presenca.unref?.();
}

/**
 * Quantas OUTRAS instâncias estão vivas agora. Na subida, zero significa que nenhum trabalho "em andamento" no banco
 * pode ser de outro processo, então é seguro marcá-lo como interrompido. Em erro do banco assume que há outras (não mexe).
 */
export async function outrasInstanciasVivas(): Promise<number> {
    try {
        return await prisma.jobLock.count({
            where: { name: { startsWith: PRESENCA_PREFIXO, not: `${PRESENCA_PREFIXO}${HOLDER}` }, expiresAt: { gt: new Date() } },
        });
    } catch {
        return 1;
    }
}
