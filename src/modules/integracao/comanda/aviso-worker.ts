import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isOptedOut as isOptedOutDb } from "@/lib/optout";
import { waManager } from "@/modules/whatsapp/manager";
import { getProvider } from "@/modules/whatsapp/provider";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider/types";
import { sessaoDaBarraca, type PayloadAviso } from "./aviso-registro";
import { VALIDADE_MS, type TipoAviso } from "./aviso-textos";

/**
 * Worker dos avisos pendentes: envia pelo WhatsApp (Baileys) da barraca, com retentativa própria.
 *
 * Regras:
 * - Sessão desconectada: o aviso espera até a validade (VALIDADE_MS); depois vira `pulado_desconectado`. Nada acumula
 *   fila para sair horas depois.
 * - Falha de envio: poucas tentativas com espera crescente (ESPERA_RETENTATIVA_MS), depois `falhou`.
 * - Teto de envio por minuto e por dia por número, mais baixo na primeira semana de um número novo.
 * - Cliente descadastrado ("SAIR") nunca recebe.
 * - O banco só guarda códigos fixos de motivo: nunca telefone, nome nem texto da mensagem.
 */

const TAG = "AvisoWorker";

export const INTERVALO_WORKER_MS = 5_000;
export const LOTE = 20;
/** Reserva do aviso enquanto um worker o processa; se o processo cair, ele volta a ficar disponível depois disto. */
export const RESERVA_MS = 60_000;
export const ESPERA_RETENTATIVA_MS = [5_000, 30_000, 120_000];
export const MAX_TENTATIVAS = ESPERA_RETENTATIVA_MS.length + 1;
export const ESPERA_SEM_SESSAO_MS = 20_000;
export const ESPERA_TETO_MS = 30_000;

/** Tetos por barraca. "Novo" = vínculo com menos de NOVO_DIAS dias. */
export const NOVO_DIAS = 7;
export const TETO_POR_MINUTO = { novo: 6, normal: 20 };
export const TETO_POR_DIA = { novo: 100, normal: 800 };
/** Pausa aleatória antes de cada envio, para não sair em rajada regular. */
export const JITTER_MS = { min: 1_000, max: 3_000 };

export interface LinhaAviso {
    id: string;
    barracaId: string;
    pedidoId: string;
    tipo: string;
    tentativas: number;
    ocorridoEm: Date;
    motivo: string | null;
    payload: unknown;
}

export interface WorkerDb {
    avisoPedido: {
        findMany(args: unknown): Promise<LinhaAviso[]>;
        updateMany(args: unknown): Promise<{ count: number }>;
        update(args: unknown): Promise<unknown>;
        count(args: unknown): Promise<number>;
    };
    barracaSessao: { findFirst(args: unknown): Promise<{ sessionId: string; createdAt: Date } | null> };
}

export interface WorkerDeps {
    db: WorkerDb;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
    random: () => number;
    estaConectada: (sessionId: string) => boolean;
    getProvider: (sessionId: string) => WhatsAppProvider | null;
    isOptedOut: (sessionId: string, jid: string) => Promise<boolean>;
    logger: { info: (tag: string, msg: string) => void; warn: (tag: string, msg: string) => void; error: (tag: string, msg: string) => void };
}

const depsPadrao = (): WorkerDeps => ({
    db: prisma as never,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: Math.random,
    estaConectada: (sessionId) => waManager.getInstance(sessionId)?.status === "CONNECTED",
    getProvider,
    isOptedOut: isOptedOutDb,
    logger,
});

function ehPayload(p: unknown): p is PayloadAviso {
    const o = p as Partial<PayloadAviso> | null;
    return !!o && typeof o.telefone === "string" && typeof o.texto === "string";
}

async function finalizar(db: WorkerDb, id: string, estado: string, motivo: string | null, extra: Record<string, unknown> = {}) {
    await db.avisoPedido.update({ where: { id }, data: { estado, motivo, payload: Prisma.DbNull, ...extra } });
}

async function adiar(db: WorkerDb, id: string, ate: number, motivo: string | null, extra: Record<string, unknown> = {}) {
    await db.avisoPedido.update({ where: { id }, data: { proximaTentativaEm: new Date(ate), motivo, ...extra } });
}

/** Processa um aviso já reservado. Nunca lança: qualquer falha vira estado ou nova tentativa. */
export async function processarAviso(linha: LinhaAviso, deps: WorkerDeps): Promise<void> {
    const { db } = deps;
    const agora = deps.now();
    const tipo = linha.tipo as TipoAviso;
    const validade = VALIDADE_MS[tipo] ?? VALIDADE_MS.pronto;
    const expirou = agora - linha.ocorridoEm.getTime() > validade;

    if (!ehPayload(linha.payload)) {
        await finalizar(db, linha.id, "falhou", "sem_dados_para_envio");
        return;
    }
    const { telefone, texto } = linha.payload;

    const vinculo = await sessaoDaBarraca(linha.barracaId, db);
    const sessionId = vinculo?.sessionId ?? null;
    const conectada = !!sessionId && deps.estaConectada(sessionId);

    if (!conectada) {
        if (expirou) await finalizar(db, linha.id, "pulado_desconectado", "validade_expirada");
        else await adiar(db, linha.id, agora + ESPERA_SEM_SESSAO_MS, "sessao_desconectada");
        return;
    }

    // Tetos por barraca (contados no banco: valem entre reinícios).
    const novo = agora - vinculo!.createdAt.getTime() < NOVO_DIAS * 24 * 60 * 60 * 1000;
    const perfil = novo ? "novo" : "normal";
    const [ultimoMinuto, ultimoDia] = await Promise.all([
        db.avisoPedido.count({ where: { barracaId: linha.barracaId, estado: "enviado", enviadoEm: { gte: new Date(agora - 60_000) } } }),
        db.avisoPedido.count({ where: { barracaId: linha.barracaId, estado: "enviado", enviadoEm: { gte: new Date(agora - 24 * 60 * 60 * 1000) } } }),
    ]);
    if (ultimoDia >= TETO_POR_DIA[perfil]) {
        if (expirou) await finalizar(db, linha.id, "falhou", "teto_diario");
        else await adiar(db, linha.id, agora + ESPERA_TETO_MS, "teto_diario");
        return;
    }
    if (ultimoMinuto >= TETO_POR_MINUTO[perfil]) {
        if (expirou) await finalizar(db, linha.id, "falhou", "teto_por_minuto");
        else await adiar(db, linha.id, agora + ESPERA_TETO_MS, "teto_por_minuto");
        return;
    }

    if (expirou) {
        await finalizar(db, linha.id, "pulado_desconectado", "validade_expirada");
        return;
    }

    try {
        if (await deps.isOptedOut(sessionId!, `${telefone}@s.whatsapp.net`)) {
            await finalizar(db, linha.id, "pulado_optout", null);
            return;
        }
        const provider = deps.getProvider(sessionId!);
        if (!provider || !provider.isConnected()) {
            await adiar(db, linha.id, agora + ESPERA_SEM_SESSAO_MS, "sessao_desconectada");
            return;
        }
        await deps.sleep(JITTER_MS.min + Math.floor(deps.random() * (JITTER_MS.max - JITTER_MS.min + 1)));
        const jid = await provider.resolveRecipient(`${telefone}@s.whatsapp.net`);
        await provider.sendText(jid, texto);
        await finalizar(db, linha.id, "enviado", null, { tentativas: linha.tentativas + 1, enviadoEm: new Date(deps.now()) });
        deps.logger.info(TAG, `${linha.tipo} enviado`);
    } catch (e) {
        const semWhatsapp = e instanceof Error && /não possui WhatsApp/i.test(e.message);
        const tentativas = linha.tentativas + 1;
        if (semWhatsapp) {
            await finalizar(db, linha.id, "falhou", "numero_sem_whatsapp", { tentativas });
        } else if (tentativas >= MAX_TENTATIVAS) {
            await finalizar(db, linha.id, "falhou", "erro_envio", { tentativas });
        } else {
            await adiar(db, linha.id, deps.now() + ESPERA_RETENTATIVA_MS[tentativas - 1], "erro_envio", { tentativas });
        }
        deps.logger.warn(TAG, `${linha.tipo} falhou (tentativa ${tentativas}): ${semWhatsapp ? "numero_sem_whatsapp" : "erro_envio"}`);
    }
}

/**
 * Reserva e processa os avisos pendentes que já venceram a espera. A reserva (updateMany condicional) impede que
 * dois workers peguem o mesmo aviso. Devolve quantos processou.
 */
export async function processarPendentes(over: Partial<WorkerDeps> = {}): Promise<number> {
    const deps: WorkerDeps = { ...depsPadrao(), ...over };
    const agora = deps.now();
    const linhas = await deps.db.avisoPedido.findMany({
        where: { estado: "pendente", proximaTentativaEm: { lte: new Date(agora) } },
        orderBy: { proximaTentativaEm: "asc" },
        take: LOTE,
        select: { id: true, barracaId: true, pedidoId: true, tipo: true, tentativas: true, ocorridoEm: true, motivo: true, payload: true },
    });
    let feitos = 0;
    for (const linha of linhas) {
        const reservada = await deps.db.avisoPedido.updateMany({
            where: { id: linha.id, estado: "pendente", proximaTentativaEm: { lte: new Date(agora) } },
            data: { proximaTentativaEm: new Date(agora + RESERVA_MS) },
        });
        if (reservada.count !== 1) continue;
        try {
            await processarAviso(linha, deps);
        } catch (e) {
            // Falha de banco no meio do aviso: a reserva expira e o aviso volta sozinho.
            deps.logger.error(TAG, `erro ao processar aviso: ${e instanceof Error ? e.name : "erro"}`);
        }
        feitos++;
    }
    return feitos;
}

const g = globalThis as unknown as { __avisoWorker?: { timer: NodeJS.Timeout; rodando: boolean } };

async function rodar(): Promise<void> {
    const w = g.__avisoWorker;
    if (!w || w.rodando) return;
    w.rodando = true;
    try {
        await processarPendentes();
    } catch (e) {
        logger.error(TAG, `ciclo falhou: ${e instanceof Error ? e.name : "erro"}`);
    } finally {
        w.rodando = false;
    }
}

/** Liga o worker (uma vez por processo). Chamado no boot do servidor e ao registrar um aviso. */
export function iniciarWorkerAvisos(): void {
    if (g.__avisoWorker) return;
    const timer = setInterval(() => void rodar(), INTERVALO_WORKER_MS);
    timer.unref?.();
    g.__avisoWorker = { timer, rodando: false };
}

/** Roda um ciclo agora, sem esperar o intervalo (depois de gravar um aviso novo). */
export function acordarWorkerAvisos(): void {
    iniciarWorkerAvisos();
    void rodar();
}
