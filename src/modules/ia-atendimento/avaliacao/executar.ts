import { LlmAnthropic } from "../llm";
import { avaliar, resumo } from "./avaliar";
import { lerArgs } from "./args";
import { formatarUso, medirUso } from "./custo";

/**
 * `npm run ia:avaliar` — roda a bateria contra o modelo REAL (gasta dinheiro: cada rodada completa são dezenas de chamadas).
 * Lê IA_MODELO e ANTHROPIC_API_KEY do ambiente ou do arquivo `.env.avaliacao` (fora do git). Nunca imprime a chave,
 * as mensagens dos casos nem as respostas: só o nome do caso, o motivo da falha e as contagens de tokens.
 * Opções: `--caso=trecho` roda só os casos cujo nome contém o trecho; `--modelo=claude-haiku-5-5` troca o modelo só nesta
 * rodada (para comparar custo e qualidade). No fim imprime os tokens e o custo ESTIMADO da rodada.
 * Saída 0 = tudo passou, 1 = falhou, 2 = sem configuração.
 */
async function main() {
    try {
        process.loadEnvFile(".env.avaliacao");
    } catch {
        // arquivo opcional
    }
    if (!process.env.IA_MODELO?.trim() || !process.env.ANTHROPIC_API_KEY?.trim()) {
        console.error("Faltam IA_MODELO e/ou ANTHROPIC_API_KEY. Veja src/modules/ia-atendimento/avaliacao/README.md");
        process.exit(2);
    }
    const args = lerArgs(process.argv);
    const modelo = args.modelo ?? process.env.IA_MODELO.trim();
    console.log(`Modelo: ${modelo}`);
    const medido = medirUso(new LlmAnthropic({ modelo, onUso: () => undefined }));
    const rel = await avaliar(medido.llm, {
        filtro: args.caso,
        aoTerminarCaso: (r) => console.log(`${r.passou ? "OK   " : "FALHA"} [${r.categoria}] ${r.nome}${r.motivo ? ` - ${r.motivo}` : ""}`),
    });
    console.log(`\n${resumo(rel)}`);
    console.log(`Uso: ${formatarUso(medido.total(), modelo, medido.chamadas())}`);
    process.exit(rel.passaram === rel.total ? 0 : 1);
}

main().catch((e) => {
    console.error(`Erro: ${(e as { name?: string })?.name ?? "erro"}`);
    process.exit(2);
});
