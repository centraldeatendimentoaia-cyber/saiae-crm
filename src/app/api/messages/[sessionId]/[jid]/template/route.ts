import { NextResponse, NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { getProvider } from "@/modules/whatsapp/provider";
import { CloudApiError, type CloudErrorKind } from "@/modules/whatsapp/cloud/errors";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const TAG = "WhatsAppTemplate";

/** Nome do template na Meta: minúsculas, números e "_". Idioma: "pt_BR", "en_US" ou "pt". */
const bodySchema = z.object({
    name: z.string().regex(/^[a-z0-9_]{1,512}$/, "name: só minúsculas, números e _"),
    languageCode: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "languageCode: ex. pt_BR"),
    bodyParameters: z.array(z.string().min(1).max(1024)).max(20).optional(),
});

/** Status HTTP por tipo de erro (a Meta nunca é repassada como 401 para o chamador). */
const STATUS: Record<CloudErrorKind, number> = {
    invalid_request: 400,
    unsupported: 422,
    window_closed: 409,
    undeliverable: 422,
    template: 422,
    rate_limit: 429,
    auth: 502,
    network: 502,
    server: 502,
    unexpected_response: 502,
};

/**
 * POST /api/messages/{sessionId}/{jid}/template: envia um template aprovado pela Meta (Cloud API).
 * `jid` é o número com DDI (ex.: 5561999999999), com ou sem "@s.whatsapp.net".
 *
 * Só funciona em sessão Cloud API (em sessão Baileys responde 501). Não depende da janela de 24 h.
 * Nunca registra telefone nem valores: o log tem só o resultado e o código de erro da Meta.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string }> }
) {
    const fail = (status: number, message: string, extra: Record<string, unknown> = {}) =>
        NextResponse.json({ status: false, message, error: message, ...extra }, { status });

    try {
        const user = await getAuthenticatedUser(request);
        if (!user) return fail(401, "Unauthorized");

        const { sessionId, jid: rawJid } = await params;
        const jid = decodeURIComponent(rawJid);

        let json: unknown;
        try {
            json = await request.json();
        } catch {
            return fail(400, "Corpo não é um JSON válido");
        }
        const parsed = bodySchema.safeParse(json);
        if (!parsed.success) {
            return fail(400, "Corpo inválido", { details: parsed.error.issues.map((i) => `${i.path.join(".") || "corpo"}: ${i.message}`) });
        }

        // Número: só dígitos (aceita +, espaço, parênteses e traço), 8 a 15 dígitos com DDI. Nunca ecoado na resposta nem no log.
        const raw = jid.replace(/@s\.whatsapp\.net$/, "");
        const digits = raw.replace(/\D/g, "");
        if (!/^\+?[\d\s()-]+$/.test(raw) || digits.length < 8 || digits.length > 15) {
            return fail(400, "Número inválido: use só dígitos com DDI, ex.: 5561999999999");
        }

        if (!(await canAccessSession(user.id, user.role, sessionId))) return fail(403, "Forbidden - Cannot access this session");

        const provider = getProvider(sessionId);
        if (!provider) return fail(503, "Session not ready");
        if (!provider.capabilities.templates || !provider.sendTemplate) {
            return fail(501, "Templates só existem em sessões da WhatsApp Cloud API oficial.", {
                code: "CAPABILITY_NOT_SUPPORTED", capability: "templates", provider: provider.name,
            });
        }

        try {
            const result = await provider.sendTemplate(digits, {
                name: parsed.data.name,
                languageCode: parsed.data.languageCode,
                bodyParameters: parsed.data.bodyParameters,
            });
            logger.info(TAG, `template enviado (parametros=${parsed.data.bodyParameters?.length ?? 0})`);
            return NextResponse.json({ status: true, message: "Template enviado", data: { messageId: result.messageId } });
        } catch (e) {
            if (e instanceof CloudApiError) {
                logger.warn(TAG, `envio recusado: ${e.kind}${e.code !== null ? ` codigo=${e.code}` : ""}`);
                return fail(STATUS[e.kind] ?? 502, e.message, {
                    code: e.kind, metaCode: e.code, metaSubcode: e.subcode, details: e.details, fbtraceId: e.fbtraceId, retryable: e.retryable,
                });
            }
            logger.error(TAG, "erro inesperado ao enviar template");
            return fail(500, "Falha ao enviar template");
        }
    } catch (error) {
        logger.error(TAG, `erro: ${error instanceof Error ? error.name : "desconhecido"}`);
        return fail(500, "Falha ao enviar template");
    }
}
