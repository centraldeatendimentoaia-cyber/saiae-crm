import cron from "node-cron";
import { logger } from "@/lib/logger";
import { withJobLock } from "@/lib/job-lock";
import { processarProntas } from "./executor";
import { depsReais, prismaStore } from "./store-prisma";

/**
 * Worker do motor: a cada minuto executa as execuções prontas (pendentes, esperas vencidas, abandonadas).
 * Desligado por padrão: só liga com AUTOMACOES_ATIVAS=true (nenhum gatilho real existe neste sprint).
 * A trava de job evita duas varreduras ao mesmo tempo; o claim atômico por execução é a garantia de verdade.
 */
export function startAutomacoes() {
    if (process.env.AUTOMACOES_ATIVAS !== "true") return;
    cron.schedule("* * * * *", () =>
        withJobLock("cron:automacoes", 5 * 60_000, async () => {
            try {
                const r = await processarProntas(prismaStore, depsReais);
                logger.info("Automacoes", `rodada: ${JSON.stringify(r)}`);
            } catch (e) {
                logger.error("Automacoes", "falha na rodada", e);
            }
        })
    );
    logger.info("Automacoes", "worker iniciado");
}
