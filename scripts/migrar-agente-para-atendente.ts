/**
 * Migra a configuração do agente do salão (AgenteConfig) para o rascunho da atendente neutra.
 *   npx tsx scripts/migrar-agente-para-atendente.ts --sessao <baileysSessionId>                                 (simulação)
 *   npx tsx scripts/migrar-agente-para-atendente.ts --sessao <id> --aplicar --confirmo-ambiente [--sobrescrever]  (grava rascunho; recusa se já houver um)
 * Só grava o RASCUNHO: nunca publica e nunca altera AgenteConfig. Publicar e ligar é passo manual do dono.
 */
import { prisma } from "@/lib/prisma";
import { carregarConfigAgente } from "@/modules/agente-salao/agente";
import { salvarRascunho } from "@/modules/atendente/armazenamento";
import { avisoRascunhoExistente, decidirGravacao, hostDoBanco, lerArgumentos, resumirTreino, treinoAPartirDoLegadoComAvisos } from "@/modules/atendente/migrar-legado";

async function main(): Promise<number> {
    const args = lerArgumentos(process.argv.slice(2));
    if ("erro" in args) {
        console.error(`Erro: ${args.erro}`);
        return 1;
    }
    const cfg = await carregarConfigAgente(args.sessao);
    if (!cfg) {
        console.error(`Erro: a sessão "${args.sessao}" não tem AgenteConfig (nada a migrar).`);
        return 1;
    }
    const { treino, avisos } = treinoAPartirDoLegadoComAvisos(cfg);
    const rascunhoExiste = !!(await prisma.atendenteTreino.findUnique({ where: { sessionId: args.sessao }, select: { sessionId: true } }));
    console.log(resumirTreino(treino, avisos));
    if (rascunhoExiste) console.log(avisoRascunhoExistente(true));
    if (!args.aplicar) {
        console.log("\nSimulação: nada foi gravado. Use --aplicar --confirmo-ambiente para gravar o rascunho.");
        return 0;
    }
    const d = decidirGravacao({ rascunhoExiste, sobrescrever: args.sobrescrever });
    if (!d.ok) {
        console.error(`Erro: ${d.erro}`);
        return 1;
    }
    console.log(`\nBanco de destino: ${hostDoBanco(process.env.DATABASE_URL)}`);
    await salvarRascunho(args.sessao, treino);
    console.log("Rascunho gravado. Nada foi publicado: confira no chat de teste, publique e só então ligue.");
    return 0;
}

main()
    .then((c) => (process.exitCode = c))
    .catch((e) => {
        console.error(`Erro: ${(e as Error).message}`);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
