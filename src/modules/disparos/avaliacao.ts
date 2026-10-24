import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isOptedOut as isOptedOutDb, phoneKey } from "@/lib/optout";
import { waManager } from "@/modules/whatsapp/manager";
import { getProvider } from "@/modules/whatsapp/provider";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider/types";
import { avaliacaoConfig as avaliacaoConfigDb, type AvaliacaoConfig } from "@/modules/bot-pedidos/saiae";
import { estadoPadrao } from "@/modules/bot-pedidos/estado";
import { sessaoDaBarraca } from "@/modules/integracao/comanda/aviso-registro";
import { montarMensagem } from "@/modules/integracao/comanda/aviso-textos";
import { normalizeBrPhone } from "@/modules/integracao/comanda/contato";
import { ESPERA_RETENTATIVA_MS, JITTER_MS, MAX_TENTATIVAS, NOVO_DIAS, TETO_POR_DIA, TETO_POR_MINUTO } from "@/modules/integracao/comanda/aviso-worker";
import type { ComandaEvent } from "@/modules/integracao/comanda/schema";
import { dentroDaJanela, proximaJanela } from "./regras";

/**
 * Avaliação pós-entrega: 30 min depois do `entregue` o cliente recebe um pedido de nota (1 a 5); a resposta é lida nas
 * mensagens recebidas, antes do bot de pedidos. Fica desligada por padrão (config no Sai aê, checada na hora do envio).
 * Telefone, nome e senha ficam no banco só enquanto a avaliação está agendada ou aguardando resposta; depois, null.
 */

const TAG = "Avaliacao";
const MIN = 60_000;
const HORA = 60 * MIN;
const DIA_MS = 24 * HORA;

export const ATRASO_AVALIACAO_MS = 30 * MIN;
export const VALIDADE_RESPOSTA_MS = 48 * HORA;
/** Passou disto sem conseguir enviar (config fora do ar ou sessão desconectada), a avaliação é descartada. */
export const LIMITE_ENVIO_MS = 6 * HORA;
export const ESPERA_CONFIG_MS = 5 * MIN;
export const ESPERA_SEM_SESSAO_MS = 60_000;
export const ESPERA_TETO_MS = 30_000;
export const INTERVALO_WORKER_MS = 5_000;
export const LOTE = 20;
export const RESERVA_MS = 60_000;
export const MAX_COMENTARIO = 300;

export const TEXTO_AVALIACAO_PADRAO = "Olá {nome}! Como foi seu pedido {senha} na {barraca}? Responda com uma nota de 1 a 5 (5 = ótimo) e, se quiser, deixe um comentário.";
const AGRADECIMENTO_BOM = "Obrigado pela avaliação!";
const AGRADECIMENTO_RUIM = "Sentimos muito. Vamos avisar o responsável da loja para falar com você.";

/**
 * Nota = `N`, `nota N`, `N estrelas` ou `N` seguido de espaço/pontuação e um comentário (N de 1 a 5). "Quero 2 pizzas",
 * "2x yakisoba", "10", "0", "6", "4,5" e texto solto não são nota.
 */
const REGEX_NOTA = /^\s*(?:nota\s*[:-]?\s*)?([1-5])(?![\d])(?![.,]\d)(?:\s*estrelas?)?(?=$|[\s.,;:!?\-–—])\s*[-–—,.:;!?]*\s*([\s\S]*)$/i;

export function parseNota(texto: string): { nota: 1 | 2 | 3 | 4 | 5; comentario: string | null } | null {
    const m = REGEX_NOTA.exec(texto.trim());
    if (!m) return null;
    const comentario = m[2].trim().slice(0, MAX_COMENTARIO);
    return { nota: Number(m[1]) as 1 | 2 | 3 | 4 | 5, comentario: comentario || null };
}

interface PayloadAvaliacao {
    telefone: string;
    nome: string | null;
    senha: number | null;
}

function ehPayload(p: unknown): p is PayloadAvaliacao {
    const o = p as Partial<PayloadAvaliacao> | null;
    return !!o && typeof o.telefone === "string";
}

const ehDuplicata = (e: unknown) => (e as { code?: unknown } | null)?.code === "P2002";

/* ------------------------------ agendamento ------------------------------ */

export interface AgendarDb {
    barracaSessao: { findFirst(args: unknown): Promise<{ sessionId: string; createdAt: Date } | null> };
    avaliacaoPedido: { create(args: unknown): Promise<unknown> };
}

/**
 * Registra a avaliação do evento `entregue`. Pedido que já nasce entregue (entrega direta no balcão) ocupa a chave
 * única sem agendar nada. Evento repetido cai na restrição única e é ignorado. Lança se o banco falhar: a rota
 * responde 503 e a Comanda reenvia o evento.
 */
export async function agendarAvaliacaoDoEvento(event: ComandaEvent, db: AgendarDb = prisma as never): Promise<void> {
    const data = event.data as { pedido_id?: unknown; senha?: unknown; status?: unknown; cliente?: { nome?: unknown; telefone?: unknown } | null };
    if (data.status !== "entregue" || (event.type !== "order.created" && event.type !== "order.status_changed")) return;
    if (typeof data.pedido_id !== "string") return;
    if (!(await sessaoDaBarraca(event.barraca_id, db))) return;

    const ocorridoEm = new Date(event.occurred_at);
    const base = { barracaId: event.barraca_id, pedidoId: data.pedido_id, ocorridoEm, enviarEm: new Date(ocorridoEm.getTime() + ATRASO_AVALIACAO_MS) };
    const criar = async (dados: Record<string, unknown>) => {
        try {
            await db.avaliacaoPedido.create({ data: { ...base, ...dados } });
        } catch (e) {
            if (!ehDuplicata(e)) throw e;
        }
    };

    if (event.type === "order.created") {
        await criar({ estado: "pulada_desativada", motivo: "nasceu_entregue" });
        return;
    }
    const telefone = normalizeBrPhone(data.cliente?.telefone);
    if (!telefone) {
        await criar({ estado: "pulada_sem_telefone" });
        return;
    }
    const payload: PayloadAvaliacao = {
        telefone,
        nome: typeof data.cliente?.nome === "string" ? data.cliente.nome : null,
        senha: typeof data.senha === "number" ? data.senha : null,
    };
    await criar({ estado: "agendada", payload });
}

/* --------------------------- worker de envio --------------------------- */

export interface LinhaAvaliacao {
    id: string;
    barracaId: string;
    pedidoId: string;
    tentativas: number;
    ocorridoEm: Date;
    payload: unknown;
}

export interface AvaliacaoDb {
    avaliacaoPedido: {
        findMany(args: unknown): Promise<unknown[]>;
        updateMany(args: unknown): Promise<{ count: number }>;
        update(args: unknown): Promise<unknown>;
        count(args: unknown): Promise<number>;
    };
    avisoPedido: { findFirst(args: unknown): Promise<unknown | null>; count(args: unknown): Promise<number> };
    barracaSessao: { findFirst(args: unknown): Promise<{ sessionId: string; createdAt: Date } | null> };
}

export interface AvaliacaoDeps {
    db: AvaliacaoDb;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
    random: () => number;
    estaConectada: (sessionId: string) => boolean;
    getProvider: (sessionId: string) => WhatsAppProvider | null;
    isOptedOut: (sessionId: string, jid: string) => Promise<boolean>;
    config: (barracaId: string) => Promise<AvaliacaoConfig | null>;
    logger: { info: (tag: string, msg: string) => void; warn: (tag: string, msg: string) => void; error: (tag: string, msg: string) => void };
}

const depsPadrao = (): AvaliacaoDeps => ({
    db: prisma as never,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: Math.random,
    estaConectada: (sessionId) => waManager.getInstance(sessionId)?.status === "CONNECTED",
    getProvider,
    isOptedOut: isOptedOutDb,
    config: (barracaId) => avaliacaoConfigDb(barracaId),
    logger,
});

async function finalizar(db: AvaliacaoDb, id: string, estado: string, motivo: string | null, extra: Record<string, unknown> = {}) {
    await db.avaliacaoPedido.update({ where: { id }, data: { estado, motivo, payload: Prisma.DbNull, ...extra } });
}

async function adiar(db: AvaliacaoDb, id: string, ate: number, motivo: string | null, extra: Record<string, unknown> = {}) {
    await db.avaliacaoPedido.update({ where: { id }, data: { enviarEm: new Date(ate), motivo, ...extra } });
}

/** Processa uma avaliação já reservada. Nunca lança por regra de negócio. */
export async function processarAvaliacao(linha: LinhaAvaliacao, deps: AvaliacaoDeps): Promise<void> {
    const { db } = deps;
    const agora = deps.now();
    const limite = linha.ocorridoEm.getTime() + ATRASO_AVALIACAO_MS + LIMITE_ENVIO_MS;

    if (!ehPayload(linha.payload)) {
        await finalizar(db, linha.id, "falhou", "sem_dados_para_envio");
        return;
    }
    const { telefone, nome, senha } = linha.payload;

    const cfg = await deps.config(linha.barracaId);
    if (!cfg) {
        if (agora > limite) await finalizar(db, linha.id, "falhou", "config_indisponivel");
        else await adiar(db, linha.id, agora + ESPERA_CONFIG_MS, "config_indisponivel");
        return;
    }
    if (!cfg.ativo) {
        await finalizar(db, linha.id, "pulada_desativada", "desativada_pela_loja");
        return;
    }
    if (await db.avisoPedido.findFirst({ where: { barracaId: linha.barracaId, pedidoId: linha.pedidoId, tipo: "cancelado" }, select: { id: true } })) {
        await finalizar(db, linha.id, "pulada_cancelado", null);
        return;
    }

    const vinculo = await sessaoDaBarraca(linha.barracaId, db);
    if (!vinculo) {
        await finalizar(db, linha.id, "pulada_desconectada", "sem_sessao");
        return;
    }
    const sessionId = vinculo.sessionId;

    try {
        if (await deps.isOptedOut(sessionId, `${telefone}@s.whatsapp.net`)) {
            await finalizar(db, linha.id, "pulada_optout", null);
            return;
        }
        if (!deps.estaConectada(sessionId)) {
            if (agora > limite) await finalizar(db, linha.id, "pulada_desconectada", "sessao_desconectada");
            else await adiar(db, linha.id, agora + ESPERA_SEM_SESSAO_MS, "sessao_desconectada");
            return;
        }
        if (!dentroDaJanela(agora)) {
            await adiar(db, linha.id, proximaJanela(agora), "fora_da_janela");
            return;
        }

        // Tetos dos avisos de pedido (somam avisos e avaliações enviados pelo número).
        const novo = agora - vinculo.createdAt.getTime() < NOVO_DIAS * DIA_MS;
        const perfil = novo ? "novo" : "normal";
        const desde = (ms: number) => ({ gte: new Date(agora - ms) });
        const [avMin, avDia, apMin, apDia] = await Promise.all([
            db.avisoPedido.count({ where: { barracaId: linha.barracaId, estado: "enviado", enviadoEm: desde(MIN) } }),
            db.avisoPedido.count({ where: { barracaId: linha.barracaId, estado: "enviado", enviadoEm: desde(DIA_MS) } }),
            db.avaliacaoPedido.count({ where: { barracaId: linha.barracaId, enviadaEm: desde(MIN) } }),
            db.avaliacaoPedido.count({ where: { barracaId: linha.barracaId, enviadaEm: desde(DIA_MS) } }),
        ]);
        if (avDia + apDia >= TETO_POR_DIA[perfil]) {
            await adiar(db, linha.id, proximaJanela(agora), "teto_diario");
            return;
        }
        if (avMin + apMin >= TETO_POR_MINUTO[perfil]) {
            await adiar(db, linha.id, agora + ESPERA_TETO_MS, "teto_por_minuto");
            return;
        }

        const provider = deps.getProvider(sessionId);
        if (!provider || !provider.isConnected()) {
            await adiar(db, linha.id, agora + ESPERA_SEM_SESSAO_MS, "sessao_desconectada");
            return;
        }
        await deps.sleep(JITTER_MS.min + Math.floor(deps.random() * (JITTER_MS.max - JITTER_MS.min + 1)));
        const texto = montarMensagem(cfg.texto?.trim() || TEXTO_AVALIACAO_PADRAO, { nome, senha, barraca: cfg.barraca_nome });
        const jid = await provider.resolveRecipient(`${telefone}@s.whatsapp.net`);
        await provider.sendText(jid, texto);
        // Mantém o payload: a resposta é casada pelo telefone. Ele some quando a nota chega ou a janela de 48 h fecha.
        await db.avaliacaoPedido.update({ where: { id: linha.id }, data: { estado: "enviada", motivo: null, tentativas: linha.tentativas + 1, enviadaEm: new Date(deps.now()) } });
        deps.logger.info(TAG, "avaliação enviada");
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
        deps.logger.warn(TAG, `envio falhou (tentativa ${tentativas}): ${semWhatsapp ? "numero_sem_whatsapp" : "erro_envio"}`);
    }
}

/**
 * Descarta avaliações enviadas há mais de 48 h sem resposta (e limpa o telefone), depois reserva e processa as que
 * já venceram a espera. Devolve quantas processou.
 */
export async function processarAvaliacoes(over: Partial<AvaliacaoDeps> = {}): Promise<number> {
    const deps: AvaliacaoDeps = { ...depsPadrao(), ...over };
    const agora = deps.now();
    await deps.db.avaliacaoPedido.updateMany({
        where: { estado: "enviada", enviadaEm: { lt: new Date(agora - VALIDADE_RESPOSTA_MS) } },
        data: { estado: "expirada", motivo: "sem_resposta", payload: Prisma.DbNull },
    });
    const linhas = (await deps.db.avaliacaoPedido.findMany({
        where: { estado: "agendada", enviarEm: { lte: new Date(agora) } },
        orderBy: { enviarEm: "asc" },
        take: LOTE,
        select: { id: true, barracaId: true, pedidoId: true, tentativas: true, ocorridoEm: true, payload: true },
    })) as LinhaAvaliacao[];
    let feitos = 0;
    for (const linha of linhas) {
        const reservada = await deps.db.avaliacaoPedido.updateMany({
            where: { id: linha.id, estado: "agendada", enviarEm: { lte: new Date(agora) } },
            data: { enviarEm: new Date(agora + RESERVA_MS) },
        });
        if (reservada.count !== 1) continue;
        try {
            await processarAvaliacao(linha, deps);
        } catch (e) {
            // Falha de banco no meio do envio: a reserva expira e a avaliação volta sozinha.
            deps.logger.error(TAG, `erro ao processar avaliação: ${e instanceof Error ? e.name : "erro"}`);
        }
        feitos++;
    }
    return feitos;
}

const g = globalThis as unknown as { __avaliacaoWorker?: { timer: NodeJS.Timeout; rodando: boolean } };

async function rodar(): Promise<void> {
    const w = g.__avaliacaoWorker;
    if (!w || w.rodando) return;
    w.rodando = true;
    try {
        await processarAvaliacoes();
    } catch (e) {
        logger.error(TAG, `ciclo falhou: ${e instanceof Error ? e.name : "erro"}`);
    } finally {
        w.rodando = false;
    }
}

/** Liga o worker (uma vez por processo). Chamado no boot do servidor e pela rota de eventos. */
export function iniciarWorkerAvaliacoes(): void {
    if (g.__avaliacaoWorker) return;
    const timer = setInterval(() => void rodar(), INTERVALO_WORKER_MS);
    timer.unref?.();
    g.__avaliacaoWorker = { timer, rodando: false };
}

/* ------------------------------ resposta ------------------------------ */

export interface RespostaDb {
    barracaSessao: { findUnique(args: unknown): Promise<{ barracaId: string } | null> };
    avaliacaoPedido: {
        findMany(args: unknown): Promise<{ id: string; pedidoId: string; payload: unknown }[]>;
        updateMany(args: unknown): Promise<{ count: number }>;
    };
}

export interface RespostaDeps {
    db: RespostaDb;
    now: () => number;
    conversaAberta: (sessionId: string, contactKey: string) => boolean;
    getProvider: (sessionId: string) => WhatsAppProvider | null;
    config: (barracaId: string) => Promise<AvaliacaoConfig | null>;
    logger: { info: (tag: string, msg: string) => void; warn: (tag: string, msg: string) => void };
}

const respostaDepsPadrao = (): RespostaDeps => ({
    db: prisma as never,
    now: Date.now,
    conversaAberta: (sessionId, contactKey) => estadoPadrao.conversaAberta(sessionId, contactKey),
    getProvider,
    config: (barracaId) => avaliacaoConfigDb(barracaId),
    logger,
});

const primeiroNome = (nome: string | null) => (nome ?? "").trim().split(/\s+/)[0] ?? "";

/**
 * Tenta tratar a mensagem recebida como resposta a um pedido de avaliação. Devolve true se virou nota (a mensagem não
 * segue para o bot). Nunca lança. `contactKey` (telefone só com dígitos, quando o jid é @lid) tem prioridade sobre o jid.
 */
export async function tratarRespostaAvaliacao(a: { sessionId: string; jid: string; contactKey?: string; texto: string }, over: Partial<RespostaDeps> = {}): Promise<boolean> {
    const parsed = parseNota(a.texto);
    if (!parsed) return false;
    const deps: RespostaDeps = { ...respostaDepsPadrao(), ...over };
    try {
        const telefone = a.contactKey ?? a.jid;
        const chave = phoneKey(telefone);
        if (chave.length < 8) return false;
        // Cliente no meio de um pedido com o bot: "5" é resposta ao bot, não nota.
        if (deps.conversaAberta(a.sessionId, (a.contactKey ?? a.jid.split("@")[0]).replace(/\D/g, ""))) return false;

        const vinculo = await deps.db.barracaSessao.findUnique({ where: { sessionId: a.sessionId }, select: { barracaId: true } });
        if (!vinculo) return false;
        const agora = deps.now();
        const candidatas = await deps.db.avaliacaoPedido.findMany({
            where: { barracaId: vinculo.barracaId, estado: "enviada", enviadaEm: { gte: new Date(agora - VALIDADE_RESPOSTA_MS) } },
            orderBy: { enviadaEm: "desc" },
            take: 50,
            select: { id: true, pedidoId: true, payload: true },
        });
        const alvo = candidatas.find((c) => ehPayload(c.payload) && phoneKey(c.payload.telefone) === chave);
        if (!alvo || !ehPayload(alvo.payload)) return false;
        const { nome, senha } = alvo.payload;

        // Condicional em `enviada`: se duas respostas chegam juntas, só uma grava.
        const gravou = await deps.db.avaliacaoPedido.updateMany({
            where: { id: alvo.id, estado: "enviada" },
            data: { estado: "respondida", nota: parsed.nota, comentario: parsed.comentario, respondidaEm: new Date(agora), payload: Prisma.DbNull },
        });
        if (gravou.count !== 1) return false;

        const provider = deps.getProvider(a.sessionId);
        if (provider?.isConnected()) {
            await provider.sendText(a.jid, parsed.nota >= 3 ? AGRADECIMENTO_BOM : AGRADECIMENTO_RUIM).catch(() => deps.logger.warn(TAG, "agradecimento não enviado"));
            const cfg = await deps.config(vinculo.barracaId);
            const dono = normalizeBrPhone(cfg?.whatsapp_dono ?? null);
            if (dono) {
                const quem = primeiroNome(nome) || "Cliente";
                const pedido = senha === null ? "" : ` (pedido #${senha})`;
                const comentario = parsed.comentario ? `\n"${parsed.comentario}"` : "";
                const aviso = `${parsed.nota <= 2 ? "ATENÇÃO: " : ""}Avaliação de ${quem}${pedido}: nota ${parsed.nota} de 5.${comentario}`;
                try {
                    await provider.sendText(await provider.resolveRecipient(`${dono}@s.whatsapp.net`), aviso);
                } catch {
                    deps.logger.warn(TAG, "aviso ao dono não enviado");
                }
            }
        }
        deps.logger.info(TAG, "avaliação respondida");
        return true;
    } catch (e) {
        deps.logger.warn(TAG, `falha ao tratar resposta: ${(e as { name?: string })?.name ?? "erro"}`);
        return false;
    }
}
