import { z } from "zod";
import { BoundedTtlMap } from "./state";

/**
 * Pedido de envio do código de verificação do cliente final (Comanda → CRM).
 * O CRM NÃO guarda o código, o telefone nem o corpo: só reenvia pelo modelo de autenticação da Cloud API.
 */

const UUID = z.string().uuid();

const schema = z
    .object({
        barraca_id: UUID,
        /** Só dígitos, 10 ou 11, SEM o 55 (o CRM acrescenta ao enviar). */
        telefone: z.string().regex(/^[0-9]{10,11}$/),
        codigo: z.string().regex(/^[0-9]{6}$/),
        request_id: UUID,
    })
    .strict();

export type PedidoCodigo = z.infer<typeof schema>;

export function validarPedidoCodigo(json: unknown): { ok: true; dados: PedidoCodigo } | { ok: false } {
    const r = schema.safeParse(json);
    return r.success ? { ok: true, dados: r.data } : { ok: false };
}

/**
 * Idempotência por request_id, EM MEMÓRIA (10 min, até 10 mil): a Comanda pode repetir a chamada e o cliente
 * não pode receber dois códigos pela mesma tentativa. Não sobrevive a reinício: depois de um restart, uma
 * repetição reenvia o MESMO código (não gera um novo), o que é inofensivo.
 */
const vistos = new BoundedTtlMap<true>(10_000, 10 * 60 * 1000);

export const jaEnviado = (requestId: string) => vistos.has(requestId);
export const marcarEnviado = (requestId: string) => vistos.set(requestId, true);

/** Só para testes. */
export const resetarEnviadosParaTeste = () => vistos.clear();
