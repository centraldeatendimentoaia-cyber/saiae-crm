import { NextResponse } from "next/server";
import { z } from "zod";

export type Lido<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

const erroPt = z.locales.pt().localeError;

/** Mensagem curta em pt-BR da primeira falha, com o nome do campo (ex.: "options: Entrada inválida: ..."). */
export function mensagemDeErro(error: z.ZodError): string {
    const issue = error.issues[0];
    const campo = issue.path.join(".");
    return campo ? `${campo}: ${issue.message}` : issue.message;
}

/** Resposta 400 no formato que as rotas já usam: { status: false, message, error }. */
export function erro400(message: string): NextResponse {
    return NextResponse.json({ status: false, message, error: message }, { status: 400 });
}

/** Valida um valor já lido (ex.: query string ou corpo montado à mão). */
export function validar<S extends z.ZodType>(schema: S, dados: unknown): Lido<z.infer<S>> {
    const r = schema.safeParse(dados, { error: erroPt });
    if (r.success) return { ok: true, data: r.data };
    return { ok: false, response: erro400(mensagemDeErro(r.error)) };
}

/** Lê o corpo JSON da requisição e valida. JSON ausente ou malformado também vira 400 (antes caía em 500). */
export async function lerCorpo<S extends z.ZodType>(request: Request, schema: S): Promise<Lido<z.infer<S>>> {
    let corpo: unknown;
    try {
        corpo = await request.json();
    } catch {
        return { ok: false, response: erro400("Corpo da requisição inválido: envie um JSON.") };
    }
    return validar(schema, corpo);
}

/** Campo opcional que aceita ausente ou null (vira undefined), como as rotas já toleravam. */
export const opt = <T extends z.ZodType>(s: T) => s.nullish().transform((v) => v ?? undefined);
