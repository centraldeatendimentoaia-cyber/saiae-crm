import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isOptedOut as isOptedOutDb } from "@/lib/optout";
import { waManager } from "@/modules/whatsapp/manager";
import { getProvider } from "@/modules/whatsapp/provider";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider/types";
import { sessaoDaBarraca, type PayloadAviso } from "./aviso-registro";
import { VALIDADE_MS, type TipoAviso } from "./aviso-textos";
import { classifySendFailure } from "@/lib/send-failure";

/**
 * Worker dos avisos pendentes: envia pelo WhatsApp (Baileys) da barraca, com retentativa própria.
 *
 * Regras:
 * - Sessão desconectada: o aviso espera até a validade (VALIDADE_MS); depois vira `pulado_desconectado`. Nada acumula
 *   fila para sair horas depois.
 * - Falha de envio: poucas tentativas com espera crescente (ESPERA_RETENTATIVA_MS), depois `falhou`. Só falha
 *   transitória é retentada; resultado desconhecido (tempo esgotado, conexão caiu) NUNCA é reenviado.
 * - Antes de enviar o aviso vira `enviando`. Se o processo morrer ali, o aviso fica `falhou/resultado_desconhecido`
 *   (pode ou não ter saído) em vez de ser reenviado e duplicar.
 * - Teto de envio por minuto e por dia por número, mais baixo na primeira semana de um número novo.
 * - Cliente descadastrado ("SAIR") nunca recebe.
 * - O banco só guarda códigos fixos de motivo: nunca telefone, nome nem texto da mensagem.
 */

const TAG = "AvisoWorker";

export const INTERVALO_WORKER_MS = 5_000;
export const LOTE = 20;
/** Reserva do aviso enquanto um worker o processa (cada aviso é reservado na hora de processar, não no início do lote). */
export const RESERVA_MS = 120_000;
/** Aviso em `enviando` há mais que isto = processo caiu no meio do envio. */
export const ENVIANDO_EXPIRA_MS = 5 * 60_000;
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
    /** Valor de proximaTentativaEm gravado na reserva: prova de que este worker ainda é o dono do aviso. */
    reservadoAte?: Date;
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
    /** Avisa o dono da sessão no painel (perda que não pode ficar em silêncio). Sem dono resolvível: não faz nada. */
    notificarDono?: (sessionId: string, titulo: string, mensagem: string) => Promise<void>;
}

/** Dono = usuário da sessão do WhatsApp da barraca. Texto fixo: nunca telefone, nome nem conteúdo da mensagem. */
async function notificarDonoPadrao(sessionId: string, titulo: string, mensagem: string): Promise<void> {
    const sessao = await prisma.session.findUnique({ where: { sessionId }, select: { userId: true } });
    if (!sessao) return;
    await prisma.notification.create({ data: { userId: sessao.userId, type: "WARNING", title: titulo, message: mensagem } });
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
    notificarDono: notificarDonoPadrao,
});

function ehPayload(p: unknown): p is PayloadAviso {
    const o = p as Partial<PayloadAviso> | null;
    return !!o && typeof o.telefone === "string" && typeof o.texto === "string";
}

/** Só grava se o aviso ainda está com este worker (reservado por ele, ou em `enviando`); senão outra instância já o assumiu. */
function dono(linha: LinhaAviso, enviando: boolean) {
    return enviando ? { id: linha.id, estado: "enviando" } : { id: linha.id, estado: "pendente", ...(linha.reservadoAte ? { proximaTentativaEm: linha.reservadoAte } : {}) };
}

async function finalizar(db: WorkerDb, linha: LinhaAviso, estado: string, motivo: string | null, extra: Record<string, unknown> = {}, enviando = false) {
    const r = await db.avisoPedido.updateMany({ where: dono(linha, enviando), data: { estado, motivo, payload: Prisma.DbNull, ...extra } });
    if (r.count !== 1) throw new Error("aviso_assumido_por_outro_worker");
}

async function adiar(db: WorkerDb, linha: LinhaAviso, ate: number, motivo: string | null, extra: Record<string, unknown> = {}, enviando = false) {
    const r = await db.avisoPedido.updateMany({ where: dono(linha, enviando), data: { estado: "pendente", proximaTentativaEm: new Date(ate), motivo, ...extra } });
    if (r.count !== 1) throw new Error("aviso_assumido_por_outro_worker");
}

/** Processa um aviso já reservado. Nunca lança: qualquer falha vira estado ou nova tentativa. */
export async function processarAviso(linha: LinhaAviso, deps: WorkerDeps): Promise<void> {
    const { db } = deps;
    const agora = deps.now();
    const tipo = linha.tipo as TipoAviso;
    const validade = VALIDADE_MS[tipo] ?? VALIDADE_MS.pronto;
    const expirou = agora - linha.ocorridoEm.getTime() > validade;

    if (!ehPayload(linha.payload)) {
        await finalizar(db, linha, "falhou", "sem_dados_para_envio");
        return;
    }
    const { telefone, texto } = linha.payload;

    const vinculo = await sessaoDaBarraca(linha.barracaId, db);
    const sessionId = vinculo?.sessionId ?? null;
    const conectada = !!sessionId && deps.estaConectada(sessionId);

    if (!conectada) {
        if (expirou) await finalizar(db, linha, "pulado_desconectado", "validade_expirada");
        else await adiar(db, linha, agora + ESPERA_SEM_SESSAO_MS, "sessao_desconectada");
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
        if (expirou) await finalizar(db, linha, "falhou", "teto_diario");
        else await adiar(db, linha, agora + ESPERA_TETO_MS, "teto_diario");
        return;
    }
    if (ultimoMinuto >= TETO_POR_MINUTO[perfil]) {
        if (expirou) await finalizar(db, linha, "falhou", "teto_por_minuto");
        else await adiar(db, linha, agora + ESPERA_TETO_MS, "teto_por_minuto");
        return;
    }

    if (expirou) {
        await finalizar(db, linha, "pulado_desconectado", "validade_expirada");
        return;
    }

    let enviandoMarcado = false;
    try {
        if (await deps.isOptedOut(sessionId!, `${telefone}@s.whatsapp.net`)) {
            await finalizar(db, linha, "pulado_optout", null);
            return;
        }
        const provider = deps.getProvider(sessionId!);
        if (!provider || !provider.isConnected()) {
            await adiar(db, linha, agora + ESPERA_SEM_SESSAO_MS, "sessao_desconectada");
            return;
        }
        await deps.sleep(JITTER_MS.min + Math.floor(deps.random() * (JITTER_MS.max - JITTER_MS.min + 1)));
        const jid = await provider.resolveRecipient(`${telefone}@s.whatsapp.net`);
        // Marca `enviando` ANTES de chamar o provedor: se o processo morrer depois do envio, o aviso não é reenviado às cegas.
        const marcou = await db.avisoPedido.updateMany({ where: dono(linha, false), data: { estado: "enviando", motivo: null } });
        if (marcou.count !== 1) return; // reserva perdida: outro worker cuida
        enviandoMarcado = true;
        await provider.sendText(jid, texto);
        // A mensagem já saiu: se gravar o desfecho falhar NÃO pode cair no catch (viraria retentativa e duplicaria).
        // O aviso fica `enviando` e o reconciliador o fecha como resultado desconhecido (nunca reenvia).
        try {
            await finalizar(db, linha, "enviado", null, { tentativas: linha.tentativas + 1, enviadoEm: new Date(deps.now()) }, true);
            deps.logger.info(TAG, `${linha.tipo} enviado`);
        } catch (e) {
            deps.logger.error(TAG, `${linha.tipo} enviado, mas o desfecho não foi gravado: ${e instanceof Error ? e.name : "erro"}`);
        }
    } catch (e) {
        if (e instanceof Error && e.message === "aviso_assumido_por_outro_worker") return;
        // antes de marcar `enviando` nada saiu: tempo esgotado ali (ex.: resolver o número) não é "resultado desconhecido"
        const bruta = classifySendFailure(e, { sendAttempted: enviandoMarcado });
        const classe = bruta === "unknown" && !enviandoMarcado ? "transient" : bruta;
        const semWhatsapp = e instanceof Error && /não possui WhatsApp/i.test(e.message);
        const tentativas = linha.tentativas + 1;
        let motivo: string;
        if (semWhatsapp) {
            motivo = "numero_sem_whatsapp";
            await finalizar(db, linha, "falhou", motivo, { tentativas }, enviandoMarcado);
        } else if (classe === "unknown") {
            motivo = "resultado_desconhecido"; // pode ter saído: não reenvia
            await finalizar(db, linha, "falhou", motivo, { tentativas }, enviandoMarcado);
            if (enviandoMarcado && sessionId) {
                // uma notificação por aviso (o estado final é gravado uma vez só): o dono confere na conversa
                await deps.notificarDono?.(sessionId, "Aviso de pedido com resultado desconhecido", "Um aviso de pedido pode ou não ter chegado ao cliente (a conexão caiu no envio). Ele NÃO será reenviado: confira na conversa.")
                    .catch(() => deps.logger.warn(TAG, "aviso ao dono não criado"));
            }
        } else if (classe === "policy" || classe === "permanent") {
            motivo = classe === "policy" ? "bloqueio_de_politica" : "erro_permanente";
            await finalizar(db, linha, "falhou", motivo, { tentativas }, enviandoMarcado);
        } else if (tentativas >= MAX_TENTATIVAS) {
            motivo = "erro_envio";
            await finalizar(db, linha, "falhou", motivo, { tentativas }, enviandoMarcado);
        } else {
            motivo = "erro_envio";
            await adiar(db, linha, deps.now() + ESPERA_RETENTATIVA_MS[tentativas - 1], motivo, { tentativas }, enviandoMarcado);
        }
        deps.logger.warn(TAG, `${linha.tipo} falhou (tentativa ${tentativas}): ${motivo}`);
    }
}

/** Avisos que ficaram em `enviando` (processo caiu no envio): resultado desconhecido, nunca reenviados. */
export async function reconciliarEnviando(deps: Pick<WorkerDeps, "db" | "now" | "logger">): Promise<number> {
    const r = await deps.db.avisoPedido.updateMany({
        where: { estado: "enviando", atualizadoEm: { lt: new Date(deps.now() - ENVIANDO_EXPIRA_MS) } },
        data: { estado: "falhou", motivo: "resultado_desconhecido", payload: Prisma.DbNull },
    });
    if (r.count > 0) deps.logger.warn(TAG, `${r.count} aviso(s) ficaram sem desfecho (processo caiu no envio) e foram marcados como resultado desconhecido`);
    return r.count;
}

/**
 * Reserva e processa os avisos pendentes que já venceram a espera. A reserva (updateMany condicional) impede que
 * dois workers peguem o mesmo aviso. Devolve quantos processou.
 */
export async function processarPendentes(over: Partial<WorkerDeps> = {}): Promise<number> {
    const deps: WorkerDeps = { ...depsPadrao(), ...over };
    const agora = deps.now();
    await reconciliarEnviando(deps).catch(() => deps.logger.warn(TAG, "reconciliação de avisos em envio falhou"));
    const linhas = await deps.db.avisoPedido.findMany({
        where: { estado: "pendente", proximaTentativaEm: { lte: new Date(agora) } },
        orderBy: { proximaTentativaEm: "asc" },
        take: LOTE,
        select: { id: true, barracaId: true, pedidoId: true, tipo: true, tentativas: true, ocorridoEm: true, motivo: true, payload: true },
    });
    let feitos = 0;
    for (const linha of linhas) {
        const t = deps.now(); // relógio atual: o ciclo pode já ter demorado nos envios anteriores (reserva com 'agora' fixo vencia no meio do lote)
        const ate = new Date(t + RESERVA_MS);
        const reservada = await deps.db.avisoPedido.updateMany({
            where: { id: linha.id, estado: "pendente", proximaTentativaEm: { lte: new Date(t) } },
            data: { proximaTentativaEm: ate },
        });
        if (reservada.count !== 1) continue;
        try {
            await processarAviso({ ...linha, reservadoAte: ate }, deps);
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
