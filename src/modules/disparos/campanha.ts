import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { waManager } from "@/modules/whatsapp/manager";
import { sessaoDaBarraca } from "@/modules/integracao/comanda/aviso-registro";
import { normalizeBrPhone } from "@/modules/integracao/comanda/contato";
import { MAX_CAMPANHAS_DIA, MAX_DESTINATARIOS, MAX_TEXTO, VALIDADE_CAMPANHA_MS, chaveDoCliente } from "./regras";

/**
 * Campanhas de disparo (promoção e reativação) pedidas pelo Sai aê: criar, consultar e cancelar. O público já vem
 * decidido pelo app; o CRM só guarda a fila, aplica os tetos e envia (worker.ts). Toda ação só enxerga a loja do
 * corpo assinado. Telefone e nome ficam só no payload do envio pendente.
 */

const TAG = "Disparos";
const UUID = z.string().uuid();
const DIA_MS = 24 * 60 * 60 * 1000;
export const MAX_CAMPANHAS_HISTORICO = 10;
export const MAX_AVALIACOES_HISTORICO = 20;

const comum = { barraca_id: UUID, request_id: UUID };
const schema = z.discriminatedUnion("acao", [
    z
        .object({
            ...comum,
            acao: z.literal("criar"),
            tipo: z.enum(["promocao", "reativacao"]),
            texto: z
                .string()
                .min(1)
                .max(MAX_TEXTO)
                .refine((t) => t.trim().length > 0),
            barraca_nome: z.string().min(1).max(80),
            destinatarios: z
                .array(z.object({ telefone: z.string().regex(/^\d{8,15}$/), nome: z.string().max(60).nullable() }).strict())
                .min(1)
                .max(MAX_DESTINATARIOS),
        })
        .strict(),
    z.object({ ...comum, acao: z.literal("historico") }).strict(),
    z.object({ ...comum, acao: z.literal("cancelar"), campanha_id: z.string().min(1).max(40) }).strict(),
]);

export type PedidoDisparo = z.infer<typeof schema>;

export function validarPedidoDisparo(json: unknown): { ok: true; dados: PedidoDisparo } | { ok: false } {
    const r = schema.safeParse(json);
    return r.success ? { ok: true, dados: r.data } : { ok: false };
}

export type MotivoRecusa = "whatsapp_desconectado" | "campanha_em_andamento" | "limite_campanhas_dia" | "sem_destinatarios_validos";
export interface CampanhaHistorico {
    id: string;
    tipo: string;
    estado: string;
    criada_em: string;
    total: number;
    enviados: number;
    falhas: number;
    pulados: number;
    na_fila: number;
}
export interface AvaliacoesHistorico {
    media: number | null;
    total: number;
    enviadas_30d: number;
    itens: { pedido_id: string; nota: number; comentario: string | null; em: string }[];
}
export type RespostaDisparo =
    | { ok: true; campanha_id: string; total: number; invalidos: number; repetido: boolean }
    | { ok: false; motivo: MotivoRecusa }
    | { ok: true; campanhas: CampanhaHistorico[]; avaliacoes: AvaliacoesHistorico }
    | { ok: true; cancelados: number };

interface CampanhaLinha {
    id: string;
    barracaId: string;
    tipo: string;
    estado: string;
    total: number;
    criadoEm: Date;
}

/** O que a transação interativa usa. */
export interface TxDisparo {
    $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
    disparoCampanha: { count(a: unknown): Promise<number>; create(a: unknown): Promise<{ id: string }> };
    disparoEnvio: { createMany(a: unknown): Promise<unknown> };
}

export interface DisparoDeps {
    db: {
        $transaction<T>(fn: (tx: TxDisparo) => Promise<T>, opts?: { maxWait?: number; timeout?: number }): Promise<T>;
        barracaSessao: { findFirst(a: unknown): Promise<{ sessionId: string; createdAt: Date } | null> };
        disparoCampanha: {
            findUnique(a: unknown): Promise<CampanhaLinha | null>;
            findMany(a: unknown): Promise<CampanhaLinha[]>;
            count(a: unknown): Promise<number>;
            create(a: unknown): Promise<{ id: string }>;
            updateMany(a: unknown): Promise<{ count: number }>;
        };
        disparoEnvio: {
            createMany(a: unknown): Promise<unknown>;
            groupBy(a: unknown): Promise<{ campanhaId: string; estado: string; _count: { _all: number } }[]>;
            updateMany(a: unknown): Promise<{ count: number }>;
        };
        avaliacaoPedido: {
            aggregate(a: unknown): Promise<{ _avg: { nota: number | null }; _count: { nota: number } }>;
            count(a: unknown): Promise<number>;
            findMany(a: unknown): Promise<{ pedidoId: string; nota: number | null; comentario: string | null; respondidaEm: Date | null }[]>;
        };
    };
    now: () => number;
    estaConectada: (sessionId: string) => boolean;
    /** Chamado depois de gravar uma campanha nova, para o worker não esperar o próximo ciclo. */
    acordar: () => void;
}

const depsPadrao = (): DisparoDeps => ({
    db: prisma as never,
    now: Date.now,
    estaConectada: (sessionId) => waManager.getInstance(sessionId)?.status === "CONNECTED",
    // import dinâmico: o worker puxa o provider do WhatsApp, que a rota e os testes não precisam carregar
    acordar: () => void import("./worker").then((m) => m.acordarWorkerCampanhas()).catch(() => {}),
});

const ehDuplicata = (e: unknown) => (e as { code?: unknown } | null)?.code === "P2002";

/** Resposta de uma campanha que já existe para o mesmo request_id (reenvio). */
function repetida(c: CampanhaLinha, barracaId: string): RespostaDisparo {
    // request_id de outra loja: nunca devolve a campanha dela
    if (c.barracaId !== barracaId) return { ok: false, motivo: "campanha_em_andamento" };
    return { ok: true, campanha_id: c.id, total: c.total, invalidos: 0, repetido: true };
}

async function criar(p: Extract<PedidoDisparo, { acao: "criar" }>, deps: DisparoDeps): Promise<RespostaDisparo> {
    const { db } = deps;
    const existente = await db.disparoCampanha.findUnique({ where: { requestId: p.request_id } });
    if (existente) return repetida(existente, p.barraca_id);

    // Telefones válidos e únicos (a primeira ocorrência vale).
    const unicos = new Map<string, string | null>();
    let invalidos = 0;
    for (const d of p.destinatarios) {
        const tel = normalizeBrPhone(d.telefone);
        if (!tel) {
            invalidos++;
            continue;
        }
        if (!unicos.has(tel)) unicos.set(tel, d.nome ? d.nome.trim().slice(0, 60) || null : null);
    }
    if (unicos.size === 0) return { ok: false, motivo: "sem_destinatarios_validos" };

    const vinculo = await sessaoDaBarraca(p.barraca_id, db);
    if (!vinculo || !deps.estaConectada(vinculo.sessionId)) return { ok: false, motivo: "whatsapp_desconectado" };

    // Campanha e envios na MESMA transação (ou nada fica gravado). O bloqueio da linha do vínculo serializa as
    // criações da mesma loja: duas chamadas ao mesmo tempo não passam juntas pelos tetos.
    const campanhaId = crypto.randomUUID();
    let recusa: MotivoRecusa | null;
    try {
        recusa = await db.$transaction(
            async (tx) => {
                await tx.$queryRaw`SELECT id FROM BarracaSessao WHERE barracaId = ${p.barraca_id} FOR UPDATE`;
                const agora = deps.now();
                const criadasHoje = await tx.disparoCampanha.count({ where: { barracaId: p.barraca_id, criadoEm: { gte: new Date(agora - DIA_MS) } } });
                if (criadasHoje >= MAX_CAMPANHAS_DIA) return "limite_campanhas_dia";
                const emAndamento = await tx.disparoCampanha.count({
                    where: { barracaId: p.barraca_id, estado: "em_andamento", criadoEm: { gte: new Date(agora - VALIDADE_CAMPANHA_MS) } },
                });
                if (emAndamento > 0) return "campanha_em_andamento";
                await tx.disparoCampanha.create({
                    data: { id: campanhaId, barracaId: p.barraca_id, requestId: p.request_id, tipo: p.tipo, texto: p.texto.trim(), barracaNome: p.barraca_nome.trim(), total: unicos.size },
                    select: { id: true },
                });
                await tx.disparoEnvio.createMany({
                    data: [...unicos].map(([telefone, nome]) => ({
                        campanhaId,
                        barracaId: p.barraca_id,
                        chave: chaveDoCliente(p.barraca_id, telefone),
                        payload: { telefone, nome },
                    })),
                });
                return null;
            },
            { maxWait: 5_000, timeout: 20_000 }
        );
    } catch (e) {
        if (!ehDuplicata(e)) throw e;
        const outra = await db.disparoCampanha.findUnique({ where: { requestId: p.request_id } });
        if (!outra) throw e;
        return repetida(outra, p.barraca_id);
    }
    if (recusa) return { ok: false, motivo: recusa };
    logger.info(TAG, `campanha ${p.tipo} criada`);
    deps.acordar();
    return { ok: true, campanha_id: campanhaId, total: unicos.size, invalidos, repetido: false };
}

/** Estado exibido: campanha esquecida em andamento depois da validade conta como expirada. */
function estadoExibido(c: CampanhaLinha, agora: number): string {
    return c.estado === "em_andamento" && agora - c.criadoEm.getTime() > VALIDADE_CAMPANHA_MS ? "expirada" : c.estado;
}

async function historico(barracaId: string, deps: DisparoDeps): Promise<RespostaDisparo> {
    const { db } = deps;
    const agora = deps.now();
    const campanhas = await db.disparoCampanha.findMany({
        where: { barracaId },
        orderBy: { criadoEm: "desc" },
        take: MAX_CAMPANHAS_HISTORICO,
        select: { id: true, barracaId: true, tipo: true, estado: true, total: true, criadoEm: true },
    });
    const contagens = campanhas.length
        ? await db.disparoEnvio.groupBy({ by: ["campanhaId", "estado"], where: { barracaId, campanhaId: { in: campanhas.map((c) => c.id) } }, _count: { _all: true } })
        : [];
    const soma = (id: string, aceita: (estado: string) => boolean) => contagens.filter((x) => x.campanhaId === id && aceita(x.estado)).reduce((t, x) => t + x._count._all, 0);

    const comNota = { barracaId, nota: { not: null } };
    const [agg, enviadas30d, recentes] = await Promise.all([
        db.avaliacaoPedido.aggregate({ where: comNota, _avg: { nota: true }, _count: { nota: true } }),
        db.avaliacaoPedido.count({ where: { barracaId, enviadaEm: { gte: new Date(agora - 30 * DIA_MS) } } }),
        db.avaliacaoPedido.findMany({
            where: comNota,
            orderBy: { respondidaEm: "desc" },
            take: MAX_AVALIACOES_HISTORICO,
            select: { pedidoId: true, nota: true, comentario: true, respondidaEm: true },
        }),
    ]);

    return {
        ok: true,
        campanhas: campanhas.map((c) => ({
            id: c.id,
            tipo: c.tipo,
            estado: estadoExibido(c, agora),
            criada_em: c.criadoEm.toISOString(),
            total: c.total,
            enviados: soma(c.id, (e) => e === "enviado"),
            falhas: soma(c.id, (e) => e === "falhou"),
            // cancelados e expirados entram aqui para o "x de y" fechar
            pulados: soma(c.id, (e) => e.startsWith("pulado_") || e === "cancelado" || e === "expirado"),
            na_fila: soma(c.id, (e) => e === "pendente"),
        })),
        avaliacoes: {
            media: agg._avg.nota === null ? null : Math.round(agg._avg.nota * 100) / 100,
            total: agg._count.nota,
            enviadas_30d: enviadas30d,
            itens: recentes
                .filter((r): r is typeof r & { nota: number } => r.nota !== null)
                .map((r) => ({ pedido_id: r.pedidoId, nota: r.nota, comentario: r.comentario, em: (r.respondidaEm ?? new Date(0)).toISOString() })),
        },
    };
}

async function cancelar(barracaId: string, campanhaId: string, deps: DisparoDeps): Promise<RespostaDisparo> {
    const { db } = deps;
    // O filtro por loja vai junto: campanha de outra loja nunca é tocada.
    const r = await db.disparoEnvio.updateMany({
        where: { campanhaId, barracaId, estado: "pendente" },
        data: { estado: "cancelado", motivo: "cancelado_pelo_dono", payload: Prisma.DbNull },
    });
    await db.disparoCampanha.updateMany({ where: { id: campanhaId, barracaId, estado: "em_andamento" }, data: { estado: "cancelada" } });
    return { ok: true, cancelados: r.count };
}

/** Executa a ação sobre a loja do pedido. Nunca toca outra loja. */
export async function executarAcaoDisparo(p: PedidoDisparo, over: Partial<DisparoDeps> = {}): Promise<RespostaDisparo> {
    const deps: DisparoDeps = { ...depsPadrao(), ...over };
    switch (p.acao) {
        case "criar":
            return criar(p, deps);
        case "historico":
            return historico(p.barraca_id, deps);
        case "cancelar":
            return cancelar(p.barraca_id, p.campanha_id, deps);
    }
}
