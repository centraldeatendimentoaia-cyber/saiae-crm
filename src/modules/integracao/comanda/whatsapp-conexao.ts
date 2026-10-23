import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { waManager } from "@/modules/whatsapp/manager";
import { sessaoDaBarraca } from "./aviso-registro";

/**
 * Conexão do WhatsApp (Baileys) de uma barraca, operada pelo Sai aê: iniciar (gera o QR), status, desconectar e
 * histórico de avisos. A rota autentica por HMAC (segredo de plataforma COMANDA_WHATSAPP_SEGREDO); aqui só existe a lógica.
 *
 * Isolamento: toda ação recebe o `barraca_id` já autenticado e só enxerga a sessão e os avisos DESSA barraca.
 */

const TAG = "WhatsAppConexao";
const UUID = z.string().uuid();

const schema = z
    .object({
        barraca_id: UUID,
        acao: z.enum(["iniciar", "status", "desconectar", "historico"]),
        request_id: UUID,
    })
    .strict();

export type AcaoConexao = z.infer<typeof schema>["acao"];
export type PedidoConexao = z.infer<typeof schema>;

export function validarPedidoConexao(json: unknown): { ok: true; dados: PedidoConexao } | { ok: false } {
    const r = schema.safeParse(json);
    return r.success ? { ok: true, dados: r.data } : { ok: false };
}

export type EstadoConexao = "sem_sessao" | "aguardando_qr" | "conectado" | "desconectado";

export interface AvisoHistorico {
    pedido_id: string;
    tipo: string;
    estado: string;
    motivo: string | null;
    em: string;
}

export interface RespostaConexao {
    estado: EstadoConexao;
    qr: string | null;
    numero: string | null;
    avisos?: AvisoHistorico[];
}

/** O que a lógica usa da instância do Baileys (facilita o teste). */
export interface InstanciaLike {
    status: string;
    qr: string | null;
    socket: { user?: { id?: string } | null; logout(): Promise<void> } | null;
}

export interface ConexaoDeps {
    db: {
        user: { findUnique(a: unknown): Promise<{ id: string } | null>; create(a: unknown): Promise<{ id: string }> };
        session: { findUnique(a: unknown): Promise<{ id: string } | null>; update(a: unknown): Promise<unknown> };
        authState: { deleteMany(a: unknown): Promise<unknown> };
        barracaSessao: { findFirst(a: unknown): Promise<{ sessionId: string; createdAt: Date } | null>; create(a: unknown): Promise<unknown> };
        avisoPedido: { findMany(a: unknown): Promise<{ pedidoId: string; tipo: string; estado: string; motivo: string | null; atualizadoEm: Date }[]> };
        $transaction(ops: unknown[]): Promise<unknown>;
    };
    manager: {
        getInstance(sessionId: string): InstanciaLike | undefined;
        removeInstance(sessionId: string): void;
        createSession(userId: string, name: string, sessionId: string): Promise<unknown>;
        startSession(sessionId: string): Promise<void>;
    };
    env: Record<string, string | undefined>;
    sleep: (ms: number) => Promise<void>;
}

const depsPadrao = (): ConexaoDeps => ({
    db: prisma as never,
    manager: waManager as never,
    env: process.env,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});

const ehDuplicata = (e: unknown) => (e as { code?: unknown } | null)?.code === "P2002";

/** Espera, no máximo isto, o QR (ou a conexão) depois de iniciar a sessão. */
const ESPERA_QR_MS = 6_000;
const PASSO_QR_MS = 300;
export const MAX_AVISOS_HISTORICO = 20;

/**
 * Toda `Session` do CRM pertence a um `User`. As sessões das barracas pertencem a UMA conta técnica da plataforma,
 * criada pelo próprio CRM na primeira conexão (e-mail em COMANDA_WHATSAPP_USUARIO_EMAIL, padrão abaixo). A senha é
 * aleatória e descartada: ninguém entra nessa conta.
 */
const EMAIL_TECNICO_PADRAO = "avisos-whatsapp@integracao.saiae.com.br";

export async function garantirUsuarioTecnico(deps: Pick<ConexaoDeps, "db" | "env">): Promise<string> {
    const email = (deps.env.COMANDA_WHATSAPP_USUARIO_EMAIL?.trim() || EMAIL_TECNICO_PADRAO).toLowerCase();
    const achado = await deps.db.user.findUnique({ where: { email }, select: { id: true } });
    if (achado) return achado.id;
    try {
        const senha = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
        const criado = await deps.db.user.create({ data: { name: "Sai aê: avisos de pedido", email, password: senha, role: "OWNER" }, select: { id: true } });
        return criado.id;
    } catch (e) {
        if (!ehDuplicata(e)) throw e;
        const outro = await deps.db.user.findUnique({ where: { email }, select: { id: true } });
        if (!outro) throw e;
        return outro.id;
    }
}

function numeroDe(inst: InstanciaLike): string | null {
    const id = inst.socket?.user?.id;
    if (!id) return null;
    const digitos = id.split("@")[0].split(":")[0].replace(/\D/g, "");
    return digitos || null;
}

function estadoDaInstancia(inst: InstanciaLike | undefined): RespostaConexao {
    if (!inst) return { estado: "desconectado", qr: null, numero: null };
    if (inst.status === "CONNECTED") return { estado: "conectado", qr: null, numero: numeroDe(inst) };
    if (inst.status === "SCAN_QR" && inst.qr) return { estado: "aguardando_qr", qr: inst.qr, numero: null };
    return { estado: "desconectado", qr: null, numero: null };
}

async function estadoAtual(barracaId: string, deps: ConexaoDeps): Promise<RespostaConexao> {
    const vinculo = await sessaoDaBarraca(barracaId, deps.db);
    if (!vinculo) return { estado: "sem_sessao", qr: null, numero: null };
    return estadoDaInstancia(deps.manager.getInstance(vinculo.sessionId));
}

async function iniciar(barracaId: string, deps: ConexaoDeps): Promise<RespostaConexao> {
    let vinculo = await sessaoDaBarraca(barracaId, deps.db);
    if (!vinculo) {
        const userId = await garantirUsuarioTecnico(deps);
        const sessionId = `saiae-${barracaId}`;
        try {
            await deps.manager.createSession(userId, `Sai aê ${barracaId.slice(0, 8)}`, sessionId);
        } catch (e) {
            // duas chamadas ao mesmo tempo: a outra já criou a sessão
            if (!ehDuplicata(e) && !(await deps.db.session.findUnique({ where: { sessionId }, select: { id: true } }))) throw e;
        }
        try {
            await deps.db.barracaSessao.create({ data: { barracaId, sessionId } });
        } catch (e) {
            if (!ehDuplicata(e)) throw e;
        }
        vinculo = await sessaoDaBarraca(barracaId, deps.db);
        if (!vinculo) throw new Error("vinculo_nao_criado");
        logger.info(TAG, "sessão criada para a barraca");
    }

    // Só inicia se não há instância: reiniciar uma instância que já está lendo o QR deixaria um socket órfão.
    if (!deps.manager.getInstance(vinculo.sessionId)) await deps.manager.startSession(vinculo.sessionId);

    // O QR chega por evento do Baileys, um instante depois. Espera um pouco para a primeira resposta já trazê-lo.
    let resposta = estadoDaInstancia(deps.manager.getInstance(vinculo.sessionId));
    for (let esperado = 0; resposta.estado === "desconectado" && esperado < ESPERA_QR_MS; esperado += PASSO_QR_MS) {
        await deps.sleep(PASSO_QR_MS);
        resposta = estadoDaInstancia(deps.manager.getInstance(vinculo.sessionId));
    }
    return resposta;
}

async function desconectar(barracaId: string, deps: ConexaoDeps): Promise<RespostaConexao> {
    const vinculo = await sessaoDaBarraca(barracaId, deps.db);
    if (!vinculo) return { estado: "sem_sessao", qr: null, numero: null };
    const { sessionId } = vinculo;
    const inst = deps.manager.getInstance(sessionId);
    if (inst?.socket) {
        // o evento de logout do Baileys apaga as credenciais e atualiza o banco
        await inst.socket.logout().catch(() => {});
    } else {
        await deps.db.$transaction([
            deps.db.session.update({ where: { sessionId }, data: { status: "LOGGED_OUT", qr: null } }),
            deps.db.authState.deleteMany({ where: { sessionId } }),
        ]);
    }
    deps.manager.removeInstance(sessionId);
    return { estado: "desconectado", qr: null, numero: null };
}

async function historico(barracaId: string, deps: ConexaoDeps): Promise<RespostaConexao> {
    const base = await estadoAtual(barracaId, deps);
    const linhas = await deps.db.avisoPedido.findMany({
        where: { barracaId },
        orderBy: { criadoEm: "desc" },
        take: MAX_AVISOS_HISTORICO,
        select: { pedidoId: true, tipo: true, estado: true, motivo: true, atualizadoEm: true },
    });
    return {
        ...base,
        avisos: linhas.map((l) => ({ pedido_id: l.pedidoId, tipo: l.tipo, estado: l.estado, motivo: l.motivo, em: l.atualizadoEm.toISOString() })),
    };
}

/** Executa a ação sobre a sessão da barraca. Nunca toca outra barraca. */
export async function executarAcaoConexao(pedido: PedidoConexao, over: Partial<ConexaoDeps> = {}): Promise<RespostaConexao> {
    const deps: ConexaoDeps = { ...depsPadrao(), ...over };
    switch (pedido.acao) {
        case "iniciar":
            return iniciar(pedido.barraca_id, deps);
        case "status":
            return estadoAtual(pedido.barraca_id, deps);
        case "desconectar":
            return desconectar(pedido.barraca_id, deps);
        case "historico":
            return historico(pedido.barraca_id, deps);
    }
}
