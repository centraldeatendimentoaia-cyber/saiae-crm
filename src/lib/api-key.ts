import { createHash, randomBytes } from "crypto";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Gera uma chave nova (prefixo wag_ + 32 caracteres aleatórios criptográficos). */
export function generateApiKey(): string {
    const bytes = randomBytes(32);
    let result = "wag_";
    // 256 % 62 != 0, mas o viés é irrelevante para 32 caracteres (~190 bits de entropia).
    for (let i = 0; i < 32; i++) result += CHARS.charAt(bytes[i] % CHARS.length);
    return result;
}

/** SHA-256 em hex. A chave já tem alta entropia, então não precisa de salt nem KDF lento. */
export function hashApiKey(apiKey: string): string {
    return createHash("sha256").update(apiKey).digest("hex");
}

/** Texto mascarado para exibir depois da criação (a chave completa só aparece uma vez). */
export function apiKeyHint(apiKey: string): string {
    return `wag_${"•".repeat(28)}${apiKey.slice(-4)}`;
}
