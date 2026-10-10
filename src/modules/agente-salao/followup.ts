import cron from "node-cron";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isOptedOut } from "@/lib/optout";
import { waManager } from "@/modules/whatsapp/manager";
import { aplicarEtiquetaNaSessao, carregarConfigAgente } from "./agente";
import { devidoFollowUp, FOLLOWUP_MAX_HORAS, primeiroNome, textoFollowUp } from "./estado";

/**
 * Follow-up do agente do salão: UMA mensagem, `followUpHoras` depois da última resposta da IA, só para quem escreveu e
 * não respondeu, nunca quando uma pessoa assumiu, só no horário de atendimento, no máximo MAX_POR_RODADA por rodada
 * e MAX_POR_DIA por sessão, com intervalo aleatório entre envios. Nunca registra telefone nem texto em log.
 */

const TAG = "AgenteFollowUp";
const MAX_POR_RODADA = 5;
const MAX_POR_DIA = 40;
let rodando = false;

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function rodarFollowUps(agora: Date = new Date()): Promise<number> {
    if (rodando) return 0;
    rodando = true;
    let enviados = 0;
    try {
        const configs = await prisma.agenteConfig.findMany({ where: { ativo: true }, select: { sessionId: true } });
        for (const { sessionId } of configs) {
            const cfg = await carregarConfigAgente(sessionId);
            const sock = waManager.getInstance(sessionId)?.socket;
            if (!cfg?.ativo || !sock) continue;

            const desde = new Date(agora.getTime() - FOLLOWUP_MAX_HORAS * 3_600_000);
            const hojeInicio = new Date(agora.getTime() - 24 * 3_600_000);
            const feitosHoje = await prisma.agenteConversa.count({ where: { sessionId, followUpEm: { gte: hojeInicio } } });
            let restante = Math.min(MAX_POR_RODADA, MAX_POR_DIA - feitosHoje);
            if (restante <= 0) continue;

            const candidatas = await prisma.agenteConversa.findMany({
                where: { sessionId, followUpEm: null, ultimaIaPerguntou: true, ultimaIaAt: { gte: desde, lte: new Date(agora.getTime() - cfg.followUpHoras * 3_600_000) } },
                orderBy: { ultimaIaAt: "asc" },
                take: 30,
            });
            for (const c of candidatas) {
                if (restante <= 0) break;
                if (!devidoFollowUp(c, cfg, agora)) continue;
                if (c.telefone && (await isOptedOut(sessionId, `${c.telefone}@s.whatsapp.net`))) continue;
                try {
                    await sock.sendMessage(c.jid, { text: textoFollowUp(primeiroNome(c.nomePerfil), c.servico) });
                    await prisma.agenteConversa.update({ where: { id: c.id }, data: { followUpEm: new Date(), ultimaIaPerguntou: false } });
                    if (cfg.etiquetaFollowUp) await aplicarEtiquetaNaSessao(sock, sessionId, c.jid, cfg.etiquetaFollowUp);
                    enviados++;
                    restante--;
                } catch (e) {
                    logger.warn(TAG, `follow-up falhou: ${(e as { name?: string })?.name ?? "erro"}`);
                }
                await dormir(20_000 + Math.floor(Math.random() * 40_000));
            }
        }
    } catch (e) {
        logger.warn(TAG, `rodada falhou: ${(e as { name?: string })?.name ?? "erro"}`);
    } finally {
        rodando = false;
    }
    if (enviados) logger.info(TAG, `${enviados} follow-up(s) enviado(s)`);
    return enviados;
}

export function startFollowUps(): void {
    if (process.env.AGENTE_SALAO?.trim().toLowerCase() === "off") return;
    cron.schedule("*/10 * * * *", () => { rodarFollowUps(); }, { timezone: "America/Sao_Paulo" });
}
