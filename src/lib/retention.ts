import cron from "node-cron";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Limpeza diária (03:30, Brasília) para o banco não crescer sem parar e o custo ficar baixo:
 *  - mensagens com mais de MESSAGE_RETENTION_DAYS dias (padrão 90; 0 desliga);
 *  - logs de webhook com mais de WEBHOOK_LOG_RETENTION_DAYS dias (padrão 14; 0 desliga).
 * Antes de apagar, guarda em cada contato a data da última mensagem recebida,
 * para o filtro "só quem já interagiu" continuar valendo.
 */
const days = (name: string, def: number) => {
    const n = parseInt(process.env[name] || "", 10);
    return Number.isFinite(n) && n >= 0 ? n : def;
};

let running = false;

export async function runRetention(): Promise<void> {
    if (running) return;
    running = true;
    try {
        const msgDays = days("MESSAGE_RETENTION_DAYS", 90);
        if (msgDays > 0) {
            const cutoff = new Date(Date.now() - msgDays * 86_400_000);

            // 1) preserva "quem já falou com a gente"
            const last = await prisma.message.groupBy({
                by: ["sessionId", "remoteJid"],
                where: { fromMe: false, timestamp: { lt: cutoff }, NOT: [{ remoteJid: { endsWith: "@g.us" } }, { remoteJid: { endsWith: "@broadcast" } }] },
                _max: { timestamp: true },
            });
            for (const g of last) {
                const t = g._max.timestamp;
                if (!t) continue;
                await prisma.contact.updateMany({
                    where: {
                        sessionId: g.sessionId,
                        OR: [{ jid: g.remoteJid }, { lid: g.remoteJid }],
                        AND: [{ OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: t } }] }],
                    },
                    data: { lastInboundAt: t },
                });
            }

            // 2) apaga em lotes
            let total = 0;
            for (;;) {
                const ids = await prisma.message.findMany({ where: { timestamp: { lt: cutoff } }, select: { id: true }, take: 5000 });
                if (ids.length === 0) break;
                await prisma.message.deleteMany({ where: { id: { in: ids.map(i => i.id) } } });
                total += ids.length;
            }
            if (total) logger.info("Retention", `${total} mensagens com mais de ${msgDays} dias apagadas`);
        }

        const logDays = days("WEBHOOK_LOG_RETENTION_DAYS", 14);
        if (logDays > 0) {
            const r = await prisma.webhookLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - logDays * 86_400_000) } } });
            if (r.count) logger.info("Retention", `${r.count} logs de webhook apagados`);
        }
    } catch (e) {
        logger.error("Retention", "Falha na limpeza:", e);
    } finally {
        running = false;
    }
}

export function startRetention(): void {
    cron.schedule("30 3 * * *", () => { runRetention(); }, { timezone: "America/Sao_Paulo" });
}
