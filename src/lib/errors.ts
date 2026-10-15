/** Texto de um erro capturado em catch (que é `unknown`). Devolve `fallback` quando não há mensagem. */
export function errorMessage(e: unknown, fallback = ""): string {
    if (e instanceof Error && e.message) return e.message;
    if (typeof e === "string" && e) return e;
    return fallback;
}

/** Código de erro (ex.: "P2025" do Prisma) de um erro capturado, se houver. */
export function errorCode(e: unknown): string | undefined {
    const code = (e as { code?: unknown } | null)?.code;
    return typeof code === "string" ? code : undefined;
}
