import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isOptedOut as isOptedOutDb } from "@/lib/optout";
import { waManager } from "@/modules/whatsapp/manager";
import { getProvider } from "@/modules/whatsapp/provider";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider/types";
import { sessaoDaBarraca } from "@/modules/integracao/comanda/aviso-registro";
import { JITTER_CAMPANHA_MS, TETO_CAMPANHA, VALIDADE_CAMPANHA_MS, dentroDaJanela, montarTextoCampanha, proximaJanela } from "./regras";

/**
 * Worker da fila das campanhas: um envio por vez, devagar, com tetos por número, janela horária (09:00 a 20:00 de
 * São Paulo), descadastro checado na hora do envio e no máximo uma mensagem de campanha por cliente a cada 24 h.
 * O banco só guarda códigos fixos de motivo: nunca telefone, nome nem texto da mensagem. Os tetos de campanha são
 * próprios e não somam com os dos avisos de pedido.
 */

const TAG = "DisparoWorker";

export const INTERVALO_WORKER_MS = 5_000;
/** Lote pequeno: cada envio espera 8 a 25 s, então um ciclo já dura minutos. */
export const LOTE = 5;
/** Reserva do envio enquanto um worker o processa (maior que a pausa de 25 s, o envio e os tempos limite); se o processo cair, ele volta a ficar disponível depois disto. */
export const RESERVA_MS = 5 * 60_000;
export const ESPERA_RETENTATIVA_MS = [30_000, 5 * 60_000];
export const MAX_TENTATIVAS = ESPERA_RETENTATIVA_MS.length + 1;
export const ESPERA_SEM_SESSAO_MS = 60_000;
export const ESPERA_TETO_MS = 60_000;
export const NOVO_DIAS = 7;

const DIA_MS = 24 * 60 * 60 * 1000;

export interface LinhaEnvio {
    id: string;
    campanhaId: string;
    barracaId: string;
    chave: string | null;
    tentativas: number;
    payload: unknown;
}

interface CampanhaLinha {
    id: string;
    estado: string;
    texto: string;
    barracaNome: string;
    criadoEm: Date;
}

export interface WorkerDb {
    disparoEnvio: {
        findMany(args: unknown): Promise<LinhaEnvio[]>;
        updateMany(args: unknown): Promise<{ count: number }>;
        count(args: unknown): Promise<number>;
        findFirst(args: unknown): Promise<{ enviadoEm: Date | null } | null>;
    };
    disparoCampanha: {
        findUnique(args: unknown): Promise<CampanhaLinha | null>;
        updateMany(args: unknown): Promise<{ count: number }>;
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

function ehPayload(p: unknown): p is { telefone: string; nome: string | null } {
    const o = p as { telefone?: unknown; nome?: unknown } | null;
    return !!o && typeof o.telefone === "string" && (o.nome === null || typeof o.nome === "string");
}

// Condicionais em "pendente": um cancelamento do dono que chegou no meio do caminho nunca é sobrescrito.
async function finalizar(db: WorkerDb, id: string, estado: string, motivo: string | null, extra: Record<string, unknown> = {}) {
    await db.disparoEnvio.updateMany({ where: { id, estado: "pendente" }, data: { estado, motivo, payload: Prisma.DbNull, ...extra } });
}

async function adiar(db: WorkerDb, id: string, ate: number, motivo: string | null, extra: Record<string, unknown> = {}) {
    await db.disparoEnvio.updateMany({ where: { id, estado: "pendente" }, data: { proximaTentativaEm: new Date(ate), motivo, ...extra } });
}

/** Quando não resta nenhum envio pendente, a campanha deixa de estar em andamento. */
async function fecharSeAcabou(db: WorkerDb, campanha: CampanhaLinha, linha: LinhaEnvio, agora: number) {
    const restam = await db.disparoEnvio.count({ where: { campanhaId: linha.campanhaId, estado: "pendente" } });
    if (restam > 0) return;
    const expirou = agora - campanha.criadoEm.getTime() > VALIDADE_CAMPANHA_MS;
    await db.disparoCampanha.updateMany({ where: { id: linha.campanhaId, estado: "em_andamento" }, data: { estado: expirou ? "expirada" : "concluida" } });
}

/** Processa um envio já reservado. Nunca lança por regra de negócio: tudo vira estado ou nova tentativa. */
export async function processarEnvio(linha: LinhaEnvio, deps: WorkerDeps): Promise<void> {
    const { db } = deps;
    const campanha = await db.disparoCampanha.findUnique({ where: { id: linha.campanhaId } });
    if (!campanha) {
        await finalizar(db, linha.id, "falhou", "sem_campanha");
        return;
    }
    await decidir(linha, campanha, deps);
    await fecharSeAcabou(db, campanha, linha, deps.now());
}

async function decidir(linha: LinhaEnvio, campanha: CampanhaLinha, deps: WorkerDeps): Promise<void> {
    const { db } = deps;
    const agora = deps.now();
    const fim = campanha.criadoEm.getTime() + VALIDADE_CAMPANHA_MS;
    /** Nunca adia para depois do fim da validade: o item volta a tempo de ser marcado como expirado. */
    const ate = (quando: number) => Math.min(quando, fim + 1_000);

    if (campanha.estado === "cancelada") {
        await finalizar(db, linha.id, "cancelado", "cancelado_pelo_dono");
        return;
    }
    if (agora > fim) {
        await finalizar(db, linha.id, "expirado", "validade_expirada");
        return;
    }
    if (!ehPayload(linha.payload)) {
        await finalizar(db, linha.id, "falhou", "sem_dados_para_envio");
        return;
    }
    const { telefone, nome } = linha.payload;

    if (!dentroDaJanela(agora)) {
        await adiar(db, linha.id, ate(proximaJanela(agora)), "fora_da_janela");
        return;
    }

    const vinculo = await sessaoDaBarraca(linha.barracaId, db);
    const sessionId = vinculo?.sessionId ?? null;
    if (!vinculo || !sessionId || !deps.estaConectada(sessionId)) {
        if (agora + ESPERA_SEM_SESSAO_MS >= fim) await finalizar(db, linha.id, "pulado_desconectado", "sessao_desconectada");
        else await adiar(db, linha.id, agora + ESPERA_SEM_SESSAO_MS, "sessao_desconectada");
        return;
    }

    // Tetos por número (contados no banco: valem entre reinícios).
    const novo = agora - vinculo.createdAt.getTime() < NOVO_DIAS * DIA_MS;
    const [ultimoMinuto, ultimoDia] = await Promise.all([
        db.disparoEnvio.count({ where: { barracaId: linha.barracaId, estado: "enviado", enviadoEm: { gte: new Date(agora - 60_000) } } }),
        db.disparoEnvio.count({ where: { barracaId: linha.barracaId, estado: "enviado", enviadoEm: { gte: new Date(agora - DIA_MS) } } }),
    ]);
    if (ultimoDia >= (novo ? TETO_CAMPANHA.diaNovo : TETO_CAMPANHA.diaNormal)) {
        // Janela móvel de 24 h: volta quando o envio mais antigo da janela sai dela (e a janela horária decide o resto).
        const maisAntigo = await db.disparoEnvio.findFirst({
            where: { barracaId: linha.barracaId, estado: "enviado", enviadoEm: { gte: new Date(agora - DIA_MS) } },
            orderBy: { enviadoEm: "asc" },
            select: { enviadoEm: true },
        });
        const liberaEm = maisAntigo?.enviadoEm ? maisAntigo.enviadoEm.getTime() + DIA_MS + 1_000 : agora + ESPERA_TETO_MS;
        await adiar(db, linha.id, ate(Math.max(liberaEm, agora + 1_000)), "teto_diario");
        return;
    }
    if (ultimoMinuto >= TETO_CAMPANHA.minuto) {
        await adiar(db, linha.id, ate(agora + ESPERA_TETO_MS), "teto_por_minuto");
        return;
    }

    try {
        // Descadastro e teto por cliente valem na hora do envio, não na criação da campanha.
        if (await deps.isOptedOut(sessionId, `${telefone}@s.whatsapp.net`)) {
            await finalizar(db, linha.id, "pulado_optout", null);
            return;
        }
        const jaRecebeu = await db.disparoEnvio.count({ where: { barracaId: linha.barracaId, chave: linha.chave, estado: "enviado", enviadoEm: { gte: new Date(agora - DIA_MS) } } });
        if (jaRecebeu > 0) {
            await finalizar(db, linha.id, "pulado_limite_diario", null);
            return;
        }
        const provider = deps.getProvider(sessionId);
        if (!provider || !provider.isConnected()) {
            await adiar(db, linha.id, ate(agora + ESPERA_SEM_SESSAO_MS), "sessao_desconectada");
            return;
        }
        await deps.sleep(JITTER_CAMPANHA_MS.min + Math.floor(deps.random() * (JITTER_CAMPANHA_MS.max - JITTER_CAMPANHA_MS.min + 1)));
        // Durante a pausa (8 a 25 s) o dono pode cancelar, o cliente pode dizer SAIR e a janela horária pode fechar.
        if ((await db.disparoEnvio.count({ where: { id: linha.id, estado: "pendente" } })) === 0) return;
        const atual = await db.disparoCampanha.findUnique({ where: { id: linha.campanhaId } });
        if (!atual || atual.estado === "cancelada") {
            await finalizar(db, linha.id, "cancelado", "cancelado_pelo_dono");
            return;
        }
        if (await deps.isOptedOut(sessionId, telefone + "@s.whatsapp.net")) {
            await finalizar(db, linha.id, "pulado_optout", null);
            return;
        }
        if (!dentroDaJanela(deps.now())) {
            await adiar(db, linha.id, ate(proximaJanela(deps.now())), "fora_da_janela");
            return;
        }
        const jid = await provider.resolveRecipient(`${telefone}@s.whatsapp.net`);
        await provider.sendText(jid, montarTextoCampanha(campanha.texto, { nome, barraca: campanha.barracaNome }));
        await finalizar(db, linha.id, "enviado", null, { tentativas: linha.tentativas + 1, enviadoEm: new Date(deps.now()) });
        deps.logger.info(TAG, "campanha enviada");
    } catch (e) {
        const semWhatsapp = e instanceof Error && /não possui WhatsApp/i.test(e.message);
        const tentativas = linha.tentativas + 1;
        if (semWhatsapp) {
            await finalizar(db, linha.id, "falhou", "numero_sem_whatsapp", { tentativas });
        } else if (tentativas >= MAX_TENTATIVAS) {
            await finalizar(db, linha.id, "falhou", "erro_envio", { tentativas });
        } else {
            await adiar(db, linha.id, ate(deps.now() + ESPERA_RETENTATIVA_MS[tentativas - 1]), "erro_envio", { tentativas });
        }
        deps.logger.warn(TAG, `envio falhou (tentativa ${tentativas}): ${semWhatsapp ? "numero_sem_whatsapp" : "erro_envio"}`);
    }
}

/**
 * A chave do cliente só serve ao teto de 24 h: depois disso ela é apagada (o banco não guarda o identificador do cliente
 * mais que o necessário). Roda no máximo uma vez por hora. Devolve quantos envios limpou.
 */
export async function limparChaves(deps: Pick<WorkerDeps, "db" | "now">): Promise<number> {
    const r = await deps.db.disparoEnvio.updateMany({
        where: { chave: { not: null }, estado: { not: "pendente" }, atualizadoEm: { lt: new Date(deps.now() - DIA_MS) } },
        data: { chave: null },
    });
    return r.count;
}

let ultimaLimpeza = 0;

/**
 * Reserva e processa os envios pendentes que já venceram a espera. A reserva (updateMany condicional) impede que
 * dois workers peguem o mesmo envio. Devolve quantos processou.
 */
export async function processarCampanhas(over: Partial<WorkerDeps> = {}): Promise<number> {
    const deps: WorkerDeps = { ...depsPadrao(), ...over };
    const agora = deps.now();
    if (agora - ultimaLimpeza >= 60 * 60_000) {
        ultimaLimpeza = agora;
        await limparChaves(deps).catch(() => deps.logger.warn(TAG, "limpeza de chaves falhou"));
    }
    const linhas = await deps.db.disparoEnvio.findMany({
        where: { estado: "pendente", proximaTentativaEm: { lte: new Date(agora) } },
        orderBy: { proximaTentativaEm: "asc" },
        take: LOTE,
        select: { id: true, campanhaId: true, barracaId: true, chave: true, tentativas: true, payload: true },
    });
    let feitos = 0;
    for (const linha of linhas) {
        const t = deps.now(); // relógio atual: o ciclo pode já ter demorado minutos nos envios anteriores
        const reservada = await deps.db.disparoEnvio.updateMany({
            where: { id: linha.id, estado: "pendente", proximaTentativaEm: { lte: new Date(t) } },
            data: { proximaTentativaEm: new Date(t + RESERVA_MS) },
        });
        if (reservada.count !== 1) continue;
        try {
            await processarEnvio(linha, deps);
        } catch (e) {
            // Falha de banco no meio do envio: a reserva expira e o envio volta sozinho.
            deps.logger.error(TAG, `erro ao processar envio: ${e instanceof Error ? e.name : "erro"}`);
        }
        feitos++;
    }
    return feitos;
}

const g = globalThis as unknown as { __campanhaWorker?: { timer: NodeJS.Timeout; rodando: boolean } };

async function rodar(): Promise<void> {
    const w = g.__campanhaWorker;
    if (!w || w.rodando) return;
    w.rodando = true;
    try {
        await processarCampanhas();
    } catch (e) {
        logger.error(TAG, `ciclo falhou: ${e instanceof Error ? e.name : "erro"}`);
    } finally {
        w.rodando = false;
    }
}

/** Liga o worker (uma vez por processo). Chamado no boot do servidor e ao criar uma campanha. */
export function iniciarWorkerCampanhas(): void {
    if (g.__campanhaWorker) return;
    const timer = setInterval(() => void rodar(), INTERVALO_WORKER_MS);
    timer.unref?.();
    g.__campanhaWorker = { timer, rodando: false };
}

/** Roda um ciclo agora, sem esperar o intervalo (depois de gravar uma campanha nova). */
export function acordarWorkerCampanhas(): void {
    iniciarWorkerCampanhas();
    void rodar();
}
