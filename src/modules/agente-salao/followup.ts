import { TZ_SAO_PAULO } from "@/modules/atendimento-comum/tempo";
import { withJobLock } from "@/lib/job-lock";
import cron from "node-cron";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isOptedOut } from "@/lib/optout";
import { waManager } from "@/modules/whatsapp/manager";
import { aplicarEtiquetaNaSessao, carregarConfigAgente } from "./agente";
import { devidoFollowUp, FOLLOWUP_MAX_HORAS, primeiroNome, salaoAberto, textoFollowUp } from "./estado";
import { usarAtendenteNovo } from "@/modules/atendente/integracao";
import { proximoFollowUp } from "@/modules/atendente/followup";
import type { Treino } from "@/modules/atendente/treino";

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

            // Sessão com treino publicado segue o follow-up configurado pelo dono; sem treino (ou erro), o caminho abaixo, igual a antes.
            const treino = await usarAtendenteNovo(sessionId).catch(() => null);
            if (treino) {
                enviados += await rodarComTreino(sessionId, sock, cfg, treino, agora, restante);
                continue;
            }

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
                    await sock.sendMessage(c.jid, { text: textoFollowUp(primeiroNome(c.nomePerfil), c.servico, cfg.followUpTexto) });
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

/**
 * Ramo da atendente neutra: mesmos limites (restante = MAX_POR_RODADA/MAX_POR_DIA), descadastro, intervalo aleatório e
 * etiqueta do legado; o texto e o ritmo vêm de `treino.followUp`. No máximo um envio por conversa por rodada.
 */
async function rodarComTreino(
    sessionId: string,
    sock: NonNullable<ReturnType<typeof waManager.getInstance>>["socket"],
    cfg: NonNullable<Awaited<ReturnType<typeof carregarConfigAgente>>>,
    treino: Treino,
    agora: Date,
    restante: number,
): Promise<number> {
    const followUp = treino.followUp;
    const max = Math.min(followUp.maxMensagens, followUp.textos.length);
    if (max <= 0 || !sock) return 0;
    const ate = new Date(agora.getTime() - followUp.intervaloHoras * 3_600_000);
    const desde = new Date(ate.getTime() - FOLLOWUP_MAX_HORAS * 3_600_000);
    const candidatas = await prisma.agenteConversa.findMany({
        where: {
            sessionId,
            estado: { not: "humano" },
            OR: [
                { followUpEm: null, ultimaIaAt: { gte: desde, lte: ate } },
                { followUpEm: { gte: desde, lte: ate }, followUpEnvios: { lt: max } },
            ],
        },
        orderBy: { ultimaIaAt: "asc" },
        take: 30,
    });
    let enviados = 0;
    for (const c of candidatas) {
        if (restante <= 0) break;
        const p = proximoFollowUp({ conv: c, followUp, agora, expedienteAberto: salaoAberto(cfg, agora) });
        if (!p.enviar || !p.texto) continue;
        if (c.telefone && (await isOptedOut(sessionId, `${c.telefone}@s.whatsapp.net`))) continue;
        try {
            await sock.sendMessage(c.jid, { text: p.texto });
            // Envios que valem são os da sequência atual: followUpEm nulo (a cliente respondeu) recomeça do zero.
            await prisma.agenteConversa.update({ where: { id: c.id }, data: { followUpEm: new Date(), followUpEnvios: (c.followUpEm ? c.followUpEnvios : 0) + 1 } });
            if (cfg.etiquetaFollowUp) await aplicarEtiquetaNaSessao(sock, sessionId, c.jid, cfg.etiquetaFollowUp);
            enviados++;
            restante--;
        } catch (e) {
            logger.warn(TAG, `follow-up falhou: ${(e as { name?: string })?.name ?? "erro"}`);
        }
        await dormir(20_000 + Math.floor(Math.random() * 40_000));
    }
    return enviados;
}

export function startFollowUps(): void {
    if (process.env.AGENTE_SALAO?.trim().toLowerCase() === "off") return;
    cron.schedule("*/10 * * * *", () => { void withJobLock("cron:agente-followup", 30 * 60_000, () => rodarFollowUps()); }, { timezone: TZ_SAO_PAULO });
}
