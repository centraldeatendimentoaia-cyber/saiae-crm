import { executarRun, type Deps, type RunPatch, type RunRow, type StatusPasso, type Store } from "../executor";
import { validarDefinicao } from "../validador";
import { CLAIM_TTL_MS, TIMEOUT_TOTAL_MS, type Definicao, type Valor } from "../tipos";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider/types";

/**
 * Simulador de fluxo SEM efeitos externos. Roda o MESMO executor do motor sobre um armazenamento em memória, com
 * provedor e relógio fictícios: nada toca banco, sessão, WhatsApp, Meta nem rede. Este módulo não importa Prisma
 * nem os provedores reais (há teste que garante isso). Mensagens "enviadas" são só registros do que SERIA enviado.
 */

export interface MensagemSimulada { nodeId: string; tipo: "texto" | "template"; conteudo: string; params?: string[]; emMs: number }
export interface PassoSimulado { seq: number; nodeId: string; tipo: string; emMs: number }
export interface EsperaSimulada { nodeId: string; ms: number; deMs: number; ateMs: number }

export interface ResultadoSimulacao {
    ok: boolean;
    /** Preenchido quando a definição é inválida: nada foi executado. */
    erros: string[];
    status: "completed" | "failed" | "cancelled" | "waiting" | "limite_de_simulacao" | "invalida";
    motivo?: string;
    caminho: PassoSimulado[];
    mensagens: MensagemSimulada[];
    esperas: EsperaSimulada[];
    etiquetas: string[];
    transferiuHumano: boolean;
    variaveis: Record<string, Valor>;
    /** Tempo simulado total (ms) desde o início. */
    duracaoMs: number;
}

export interface OpcoesSimulacao {
    variaveis?: Record<string, Valor>;
    /** Simula um provedor que só envia texto com a janela de 24 h aberta (como a Cloud API). Padrão: texto livre sempre liberado. */
    janelaAberta?: boolean;
    /** Teto de rodadas do executor (cada rodada termina numa espera). */
    maxRodadas?: number;
}

const INICIO = Date.UTC(2030, 0, 1); // relógio fictício, fixo: a simulação é determinística

export async function simularFluxo(def: Definicao, opcoes: OpcoesSimulacao = {}): Promise<ResultadoSimulacao> {
    const vazio = (status: ResultadoSimulacao["status"], erros: string[] = []): ResultadoSimulacao => ({
        ok: false, erros, status, caminho: [], mensagens: [], esperas: [], etiquetas: [], transferiuHumano: false, variaveis: { ...(opcoes.variaveis ?? {}) }, duracaoMs: 0,
    });
    const erros = validarDefinicao(def);
    if (erros.length) return vazio("invalida", erros);

    const relogio = { t: INICIO };
    const agora = () => new Date(relogio.t);
    const mensagens: MensagemSimulada[] = [];
    const etiquetas: string[] = [];
    const esperas: EsperaSimulada[] = [];
    const caminho: PassoSimulado[] = [];
    let transferiuHumano = false;
    const desde = () => relogio.t - INICIO;

    const run: RunRow & { claimedBy: string | null; claimExpiresAt: Date | null; motivoFim?: string | null; lastError?: string | null } = {
        id: "sim", userId: "sim", sessionId: "sim", contactKey: "sim@simulador", flowVersionId: "sim", status: "pending",
        currentNodeId: def.start, context: { vars: { ...(opcoes.variaveis ?? {}) }, tentativas: {} }, stepCount: 0, claimsSemProgresso: 0,
        resumeAt: null, deadlineAt: new Date(INICIO + TIMEOUT_TOTAL_MS), claimedBy: null, claimExpiresAt: null,
    };
    const passos: { id: string; seq: number; nodeId: string; type: string; status: StatusPasso }[] = [];

    const store: Store = {
        async claimRun(_id, holder, ag, ttl) {
            const livre = run.status === "pending" || (run.status === "waiting" && !!run.resumeAt && run.resumeAt <= ag);
            if (!livre) return null;
            run.claimsSemProgresso++; run.status = "running"; run.claimedBy = holder; run.claimExpiresAt = new Date(ag.getTime() + ttl);
            return structuredClone(run);
        },
        async salvar(_id, holder, patch: RunPatch, ag) {
            if (run.claimedBy !== holder || run.status !== "running") return false;
            Object.assign(run, structuredClone(patch));
            run.claimsSemProgresso = 0;
            if (patch.status && patch.status !== "running") { run.claimedBy = null; run.claimExpiresAt = null; } else run.claimExpiresAt = new Date(ag.getTime() + CLAIM_TTL_MS);
            return true;
        },
        async ultimoPasso() {
            const p = passos[passos.length - 1];
            return p ? { ...p } : null;
        },
        async abrirPasso(_r, seq, nodeId, type, status) {
            if (passos.some((p) => p.seq === seq)) return null;
            const p = { id: `p${passos.length}`, seq, nodeId, type, status };
            passos.push(p);
            if (status !== "claimed") caminho.push({ seq, nodeId, tipo: type, emMs: desde() });
            return { ...p };
        },
        async fecharPasso(id, patch) {
            const p = passos.find((x) => x.id === id);
            if (!p) return;
            if (p.status === "claimed" && patch.status === "done") caminho.push({ seq: p.seq, nodeId: p.nodeId, tipo: p.type, emMs: desde() });
            p.status = patch.status;
            const o = patch.output as { ms?: number } | undefined;
            if (p.type === "espera" && typeof o?.ms === "number") esperas.push({ nodeId: p.nodeId, ms: o.ms, deMs: desde(), ateMs: desde() + o.ms });
        },
        async definicao() { return def; },
        async listarProntas() { return []; },
    };

    // o executor reserva o passo ("claimed") ANTES de chamar o provedor: é daí que sai o nó da mensagem
    const noReservado = () => [...passos].reverse().find((p) => p.status === "claimed")?.nodeId ?? "";

    const provedor = {
        name: "simulador", sessionId: "sim",
        capabilities: { freeTextAnytime: opcoes.janelaAberta !== false, templates: true },
        isConnected: () => true,
        resolveRecipient: async (to: string) => to,
        sendText: async (_to: string, texto: string) => { mensagens.push({ nodeId: noReservado(), tipo: "texto", conteudo: texto, emMs: desde() }); return { messageId: "simulada" }; },
        sendMedia: async () => { throw new Error("simulador: mídia não suportada"); },
        sendTemplate: async (_to: string, t: { name: string; bodyParameters?: string[] }) => { mensagens.push({ nodeId: noReservado(), tipo: "template", conteudo: t.name, params: t.bodyParameters, emMs: desde() }); return { messageId: "simulada" }; },
    } as unknown as WhatsAppProvider;

    const deps: Deps = {
        holder: "sim",
        agora,
        optedOut: async () => false,
        temAcesso: async () => true,
        conversa: async () => null,
        provider: () => ({ ok: true, provider: provedor }),
        janelaAberta: async () => opcoes.janelaAberta !== false,
        etiquetar: async (_s, _c, nome) => { etiquetas.push(nome); },
        transferirHumano: async () => { transferiuHumano = true; },
    };

    let resultado: ResultadoSimulacao["status"] = "limite_de_simulacao";
    const max = opcoes.maxRodadas ?? 100;
    for (let i = 0; i < max; i++) {
        const r = await executarRun("sim", store, deps);
        if (r === "waiting") {
            if (!run.resumeAt) { resultado = "waiting"; break; }
            relogio.t = Math.max(relogio.t, run.resumeAt.getTime()); // avança o relógio fictício até o fim da espera
            continue;
        }
        resultado = r === "completed" || r === "failed" || r === "cancelled" ? r : "failed";
        break;
    }
    const falhou = resultado === "failed" || resultado === "limite_de_simulacao";
    return {
        ok: !falhou, erros: [], status: resultado,
        motivo: run.lastError ?? run.motivoFim ?? undefined,
        caminho, mensagens, esperas, etiquetas, transferiuHumano,
        variaveis: { ...run.context.vars }, duracaoMs: desde(),
    };
}
