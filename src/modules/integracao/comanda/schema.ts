import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import eventoSchema from "./contrato/v1/evento.schema.json";

/**
 * Validação dos eventos Comanda → CRM contra a cópia fixada do contrato v1 (JSON Schema draft 2020-12).
 *
 * O schema do envelope declara `data` só como `object` e traz `$defs/pedido` sem ligá-lo a nenhum tipo.
 * O contrato (INTEGRACAO.md §2) diz que `data` dos eventos `order.*` segue `pedido`; por isso o CRM valida
 * `order.*` também contra `#/$defs/pedido`. Eventos `customer.*` e `coupon.redeemed` não têm schema de `data`
 * na v1 (aceitam qualquer objeto).
 */

export type ComandaEventType =
    | "order.created"
    | "order.paid"
    | "order.status_changed"
    | "order.ready"
    | "order.cancelled"
    | "customer.created"
    | "customer.updated"
    | "coupon.redeemed";

export interface ComandaEvent {
    id: string;
    type: ComandaEventType;
    version: 1;
    occurred_at: string;
    barraca_id: string;
    sequence: number;
    data: Record<string, unknown>;
}

export type Validation = { ok: true; event: ComandaEvent } | { ok: false; errors: string[] };

// allowUnionTypes: o schema usa "type": ["integer", "null"]. strict mantém o resto rígido.
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
ajv.addSchema(eventoSchema, "evento");

const validateEnvelope = ajv.getSchema("evento")!;
const validatePedido = ajv.getSchema("evento#/$defs/pedido")!;

/** Resume erros do Ajv só com caminho e regra: nunca inclui os valores recebidos (podem ser dados pessoais). */
function summarize(errors: typeof validateEnvelope.errors, prefix = ""): string[] {
    return (errors ?? []).slice(0, 10).map((e) => `${prefix}${e.instancePath || "/"} ${e.message ?? "inválido"}`);
}

export function validateEvento(body: unknown): Validation {
    if (!validateEnvelope(body)) return { ok: false, errors: summarize(validateEnvelope.errors) };
    const event = body as ComandaEvent;
    if (event.type.startsWith("order.") && !validatePedido(event.data)) {
        return { ok: false, errors: summarize(validatePedido.errors, "/data") };
    }
    return { ok: true, event };
}
