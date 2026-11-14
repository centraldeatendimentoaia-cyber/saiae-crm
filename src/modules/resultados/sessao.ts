import { prisma } from "@/lib/prisma";

/** Mesma ordem de canAccessSession: o id interno (cuid) vence o nome (Session.sessionId, escolhido pelo usuário). */
export async function resolverSessao(ref: string) {
    const select = { id: true, sessionId: true, userId: true } as const;
    return (await prisma.session.findFirst({ where: { id: ref }, select })) ?? (await prisma.session.findFirst({ where: { sessionId: ref }, select }));
}

/** O painel de resultados fica atrás de flag: desligado por padrão (RESULTADOS_ENABLED=true liga). */
export const resultadosAtivo = () => process.env.RESULTADOS_ENABLED === "true";
