import { z } from "zod";
import { prisma } from "@/lib/prisma";

/** Validação de servidor do gatilho guardado em `definition.trigger` (publicar e PUT do rascunho). */
export const triggerSchema = z.object({
    tipo: z.enum(["dm_palavra_chave", "dm_qualquer", "comentario_post"]),
    canal: z.enum(["instagram", "messenger"]),
    accountId: z.string().min(1).max(64),
    palavras: z.array(z.string().max(100)).max(20).optional(),
    postId: z.string().max(100).optional(),
}).strict();

const PROVEDOR = { instagram: "instagram", messenger: "facebook" } as const;

/** [] se não há gatilho ou ele é válido e a conta é do usuário e do canal; senão mensagens de erro. */
export async function validarTrigger(userId: string, def: unknown): Promise<string[]> {
    const t = typeof def === "object" && def !== null ? (def as { trigger?: unknown }).trigger : undefined;
    if (t === undefined || t === null) return [];
    const r = triggerSchema.safeParse(t);
    if (!r.success) return r.error.issues.map((i) => `trigger.${i.path.join(".") || "?"}: ${i.message}`);
    const conta = await prisma.socialAccount.findFirst({ where: { id: r.data.accountId, userId, provider: PROVEDOR[r.data.canal] }, select: { id: true } });
    return conta ? [] : ["trigger.accountId: conta social não encontrada para este canal"];
}
