/**
 * Interruptor da cobrança (BILLING_ENFORCEMENT).
 *
 * - "off" (padrão, também quando a variável não existe ou tem qualquer outro valor):
 *   todos os usuários são tratados como plano sem limite de recursos, o teste grátis não expira
 *   e nada é bloqueado por plano. O acesso e os dados continuam intactos.
 * - "on" (também "true" ou "1"): volta ao comportamento normal de src/lib/plans.ts (planos, cotas,
 *   trial e suspensão).
 *
 * É reversível: nada de Stripe, planos nem contadores de uso foi removido. Os contadores continuam
 * contando com a cobrança desligada, para os números estarem certos quando ela voltar.
 *
 * Exceção que vale nos dois modos: o teto mensal de gerações de texto com IA (custo do Gemini),
 * configurável por AI_MONTHLY_CAP.
 */

export function billingEnforced(): boolean {
    const v = (process.env.BILLING_ENFORCEMENT ?? "").trim().toLowerCase();
    return v === "on" || v === "true" || v === "1";
}

export const DEFAULT_AI_MONTHLY_CAP = 200;

/** Teto mensal de textos com IA por usuário quando a cobrança está desligada. */
export function aiMonthlyCap(): number {
    const n = Math.floor(Number(process.env.AI_MONTHLY_CAP));
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_AI_MONTHLY_CAP;
}
