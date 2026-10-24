import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { barracaName, normalizeBrPhone } from "./contato";
import { configDoAviso, montarMensagem, textoDoAviso, tipoDoEvento, type TipoAviso } from "./aviso-textos";
import type { ComandaEvent } from "./schema";

/**
 * Registro dos avisos em banco (tabela AvisoPedido). A restrição única (barraca, pedido, tipo) é a idempotência:
 * vale entre reinícios e entre instâncias do CRM. O registro roda ANTES de a rota responder 2xx; o envio é do worker.
 */

/** O que o worker precisa para enviar. Fica no banco só enquanto o aviso está pendente. */
export interface PayloadAviso {
    telefone: string; // E.164 brasileiro, só dígitos
    texto: string; // texto final, com as variáveis já preenchidas
}

export type ResultadoRegistro = "registrado" | "duplicado" | "ignorado" | "sem_sessao";

export interface RegistroDb {
    barracaSessao: { findFirst(args: unknown): Promise<{ sessionId: string; createdAt: Date } | null> };
    avisoPedido: { create(args: unknown): Promise<unknown> };
}

const TAG = "AvisoPedido";

/** Sessão mais antiga da barraca (uma barraca pode ter várias; a integração opera nesta). */
export async function sessaoDaBarraca(barracaId: string, db: Pick<RegistroDb, "barracaSessao"> = prisma as never) {
    return db.barracaSessao.findFirst({ where: { barracaId }, orderBy: { createdAt: "asc" }, select: { sessionId: true, createdAt: true } });
}

/** true se a barraca já conectou o WhatsApp pela integração. Erro de banco conta como false (caminho antigo segue). */
export async function barracaTemSessao(barracaId: string): Promise<boolean> {
    try {
        return !!(await sessaoDaBarraca(barracaId));
    } catch {
        return false;
    }
}

const ehDuplicata = (e: unknown) => (e as { code?: unknown } | null)?.code === "P2002";

async function criar(db: RegistroDb, dados: Record<string, unknown>): Promise<boolean> {
    try {
        await db.avisoPedido.create({ data: dados });
        return true;
    } catch (e) {
        if (ehDuplicata(e)) return false;
        throw e;
    }
}

/**
 * Grava o aviso do evento como `pendente` (ou já em estado final, quando não há o que enviar).
 * Lança se o banco falhar: a rota responde 503 e a Comanda reenvia o evento.
 */
export async function registrarAvisoDoEvento(event: ComandaEvent, db: RegistroDb = prisma as never): Promise<ResultadoRegistro> {
    const tipo = tipoDoEvento(event);
    if (!tipo) return "ignorado";
    const data = event.data as { pedido_id?: unknown; senha?: unknown; status?: unknown; tipo_atendimento?: unknown; barraca_nome?: unknown; cliente?: { nome?: unknown; telefone?: unknown } | null };
    if (typeof data.pedido_id !== "string") return "ignorado";
    if (!(await sessaoDaBarraca(event.barraca_id, db))) return "sem_sessao";

    const ocorridoEm = new Date(event.occurred_at);
    const base = { barracaId: event.barraca_id, pedidoId: data.pedido_id, ocorridoEm };

    // Pedido que já nasce entregue (entrega direta no balcão): o "entregue" não faz sentido. Ocupa a chave única,
    // então o status_changed seguinte cai como duplicado.
    if (event.type === "order.created" && data.status === "entregue") {
        await criar(db, { ...base, tipo: "entregue", estado: "pulado_nao_aplica", motivo: "nasceu_entregue" });
    }

    const cfg = configDoAviso(event.data, tipo);
    if (!cfg.ativo) {
        const novo = await criar(db, { ...base, tipo, estado: "pulado_nao_aplica", motivo: "desativado_pela_loja" });
        return novo ? "registrado" : "duplicado";
    }

    const telefone = normalizeBrPhone(data.cliente?.telefone);
    if (!telefone) {
        const novo = await criar(db, { ...base, tipo, estado: "pulado_sem_telefone" });
        if (novo) logger.info(TAG, `${tipo} pulado: telefone ausente ou inválido`);
        return novo ? "registrado" : "duplicado";
    }

    const payload: PayloadAviso = { telefone, texto: montarTextoFinal(tipo, event, data, cfg.texto) };
    const novo = await criar(db, { ...base, tipo, estado: "pendente", payload });
    if (!novo) logger.info(TAG, `${tipo} duplicado`);
    return novo ? "registrado" : "duplicado";
}

function montarTextoFinal(
    tipo: TipoAviso,
    event: ComandaEvent,
    data: { senha?: unknown; tipo_atendimento?: unknown; barraca_nome?: unknown; cliente?: { nome?: unknown } | null },
    personalizado: string | null
): string {
    const modelo = textoDoAviso(tipo, personalizado, data.tipo_atendimento === "entrega");
    return montarMensagem(modelo, {
        nome: typeof data.cliente?.nome === "string" ? data.cliente.nome : null,
        senha: typeof data.senha === "number" ? data.senha : null,
        barraca: barracaName(event.barraca_id, process.env, data.barraca_nome),
    });
}
