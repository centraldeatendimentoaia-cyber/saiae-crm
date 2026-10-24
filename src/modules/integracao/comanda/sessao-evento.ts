import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Aviso de estado da sessão do WhatsApp, CRM → Sai aê: POST em COMANDA_WHATSAPP_EVENTO_URL
 * ({SUPABASE}/functions/v1/crm-evento-sessao), com a mesma assinatura do contrato:
 * X-Saiae-Signature = "sha256=" + HMAC-SHA256(segredo, timestamp + "." + corpo bruto).
 * Segredo de plataforma COMANDA_WHATSAPP_SEGREDO (se houver lista para rotação, assina com o primeiro).
 *
 * Melhor esforço: nunca lança, nunca bloqueia a conexão. O log não leva telefone nem o corpo.
 */

export type EstadoSessaoEvento = "conectado" | "desconectado" | "caiu";

const TAG = "SessaoEvento";
const TENTATIVAS = 3;
const TIMEOUT_MS = 5_000;

export function segredosWhatsapp(env: Record<string, string | undefined> = process.env): string[] {
    return (env.COMANDA_WHATSAPP_SEGREDO ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length >= 16);
}

export function assinar(segredo: string, timestamp: string, corpo: string): string {
    return "sha256=" + crypto.createHmac("sha256", segredo).update(`${timestamp}.${corpo}`).digest("hex");
}

export interface EnvioDeps {
    fetch: typeof fetch;
    env: Record<string, string | undefined>;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
    barracaDaSessao: (sessionId: string) => Promise<string | null>;
}

const depsPadrao = (): EnvioDeps => ({
    fetch,
    env: process.env,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    barracaDaSessao: async (sessionId) => (await prisma.barracaSessao.findUnique({ where: { sessionId }, select: { barracaId: true } }))?.barracaId ?? null,
});

/** Avisa o Sai aê que a sessão da barraca mudou de estado. Sessão sem vínculo com barraca é ignorada. */
export async function avisarEstadoSessao(sessionId: string, estado: EstadoSessaoEvento, over: Partial<EnvioDeps> = {}): Promise<boolean> {
    const deps: EnvioDeps = { ...depsPadrao(), ...over };
    try {
        const url = deps.env.COMANDA_WHATSAPP_EVENTO_URL?.trim();
        const segredo = segredosWhatsapp(deps.env)[0];
        if (!url || !segredo) return false; // integração não configurada neste ambiente
        const barracaId = await deps.barracaDaSessao(sessionId);
        if (!barracaId) return false; // sessão comum do CRM, sem barraca

        const requestId = crypto.randomUUID();
        const corpo = JSON.stringify({ barraca_id: barracaId, estado, occurred_at: new Date(deps.now()).toISOString(), request_id: requestId });

        for (let i = 1; i <= TENTATIVAS; i++) {
            try {
                const timestamp = String(Math.floor(deps.now() / 1000));
                const resp = await deps.fetch(url, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        "x-saiae-event-id": requestId,
                        "x-saiae-timestamp": timestamp,
                        "x-saiae-signature": assinar(segredo, timestamp, corpo),
                    },
                    body: corpo,
                    signal: AbortSignal.timeout(TIMEOUT_MS),
                });
                if (resp.ok) return true;
                if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) break; // recusa definitiva: repetir não adianta
            } catch {
                /* rede ou timeout: tenta de novo */
            }
            if (i < TENTATIVAS) await deps.sleep(2_000 * i);
        }
        logger.warn(TAG, `aviso "${estado}" não entregue ao Sai aê`);
        return false;
    } catch {
        return false;
    }
}

/** Dispara sem esperar: usado dentro dos eventos de conexão do Baileys. */
export function avisarEstadoSessaoEmSegundoPlano(sessionId: string, estado: EstadoSessaoEvento): void {
    void avisarEstadoSessao(sessionId, estado).catch(() => {});
}
