import { prisma } from "@/lib/prisma";

/** ResultEvent não tem chave estrangeira (userId/sessionId são texto): a exclusão em cascata é manual, nestes pontos. */
export const apagarResultadosDaSessao = (userId: string, sessionId: string) => prisma.resultEvent.deleteMany({ where: { userId, sessionId } });
export const apagarResultadosDoUsuario = (userId: string) => prisma.resultEvent.deleteMany({ where: { userId } });
/** Desfaz um lote de importação (escopado pelo dono e pela sessão). */
export const desfazerImportacao = (userId: string, sessionId: string, importacaoId: string) => prisma.resultEvent.deleteMany({ where: { userId, sessionId, importacaoId } });
