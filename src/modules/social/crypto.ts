import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/** Chave de 32 bytes: SOCIAL_TOKEN_KEY (preferida) ou derivada do AUTH_SECRET. */
function key(): Buffer {
    const secret = process.env.SOCIAL_TOKEN_KEY || process.env.AUTH_SECRET;
    if (!secret) throw new Error("Defina SOCIAL_TOKEN_KEY (ou AUTH_SECRET) para guardar tokens das redes sociais.");
    return createHash("sha256").update(secret).digest();
}

/** AES-256-GCM → "iv.tag.dados" em base64. */
export function encryptToken(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key(), iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decryptToken(payload: string): string {
    const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
    if (!iv || !tag || !data) throw new Error("Token salvo em formato inválido.");
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
