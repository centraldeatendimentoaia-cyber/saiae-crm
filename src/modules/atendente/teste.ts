import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { LlmAnthropic, type Llm } from "@/modules/ia-atendimento/llm";
import { responderAtendente } from "./motor";
import { TreinoSchema, type Treino } from "./treino";

/**
 * Apoio das telas de treino: simula o motor com o RASCUNHO sem tocar no WhatsApp e sem gravar nada (nem Message, nem
 * VendaIA, nem Contact). Os callbacks de ação só registram que foram chamados.
 */

const JANELA_MS = 60_000;
export const LIMITE_POR_MINUTO = 20;
const usos = new Map<string, { inicio: number; gasto: number }>();

/** Limite por usuário porque cada simulação gasta tokens. `peso` conta quantas chamadas ao modelo o pedido pode fazer. */
// shortcut: contador em memória, por processo; com várias instâncias o teto efetivo multiplica, trocar por Redis se isso importar.
export function liberarUso(userId: string, peso = 1, agora = Date.now()): boolean {
    for (const [k, v] of usos) if (agora - v.inicio >= JANELA_MS) usos.delete(k);
    const u = usos.get(userId) ?? { inicio: agora, gasto: 0 };
    if (u.gasto + peso > LIMITE_POR_MINUTO) return false;
    u.gasto += peso;
    usos.set(userId, u);
    return true;
}

export function zerarLimite(): void {
    usos.clear();
}

let llm: Llm | null | undefined;
/** Mesmo Llm do agente (IA_MODELO_SALAO ou IA_MODELO + ANTHROPIC_API_KEY); null quando não configurado. */
export function obterLlm(): Llm | null {
    if (llm !== undefined) return llm;
    const modelo = (process.env.IA_MODELO_SALAO ?? process.env.IA_MODELO ?? "").trim();
    llm = modelo && process.env.ANTHROPIC_API_KEY?.trim() ? new LlmAnthropic({ modelo }) : null;
    return llm;
}

export type Rascunho = { treino: Treino } | { erro: 404 | 409; mensagem: string };

/** Rascunho da sessão (chave = sessionId do Baileys). */
export async function lerRascunho(sessionId: string): Promise<Rascunho> {
    const t = await prisma.atendenteTreino.findUnique({ where: { sessionId } });
    if (!t) return { erro: 404, mensagem: "Esta sessão ainda não tem rascunho. Salve o treino primeiro." };
    const r = TreinoSchema.safeParse(t.rascunho);
    if (!r.success) return { erro: 409, mensagem: "O rascunho salvo está inválido. Corrija e salve de novo." };
    return { treino: r.data };
}

export interface Simulacao {
    resposta: string[];
    passouParaPessoa: boolean;
    vendaRegistrada: boolean;
    falhou: boolean;
}

export async function simular(llmUsado: Llm, treino: Treino, historico: { direcao: "in" | "out"; texto: string }[], texto: string): Promise<Simulacao> {
    const d = treino.roteiro.desfecho;
    const s = await responderAtendente(
        {
            llm: llmUsado,
            treino,
            link: d.tipo === "link" ? d.link : null,
            etiquetas: [],
            onPassarParaPessoa: async () => true,
            onEtiquetar: async () => true,
            onRegistrarVenda: async () => true,
            logger,
        },
        {
            texto,
            historico,
            agora: new Date(),
            atendimentoHumanoAberto: true,
            primeiraResposta: !historico.some((h) => h.direcao === "out"),
            mensagensSemAvancar: 0,
        },
    );
    return { resposta: s.mensagens, passouParaPessoa: s.passouParaPessoa, vendaRegistrada: s.vendaRegistrada, falhou: s.falhou };
}
