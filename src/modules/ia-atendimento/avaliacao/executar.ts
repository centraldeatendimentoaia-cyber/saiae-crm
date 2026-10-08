import { LlmAnthropic } from "../llm";
import { avaliar, resumo } from "./avaliar";

/**
 * `npm run ia:avaliar` — roda a bateria contra o modelo REAL (gasta tokens: ~22 casos, poucas chamadas cada).
 * Lê IA_MODELO e ANTHROPIC_API_KEY do ambiente ou do arquivo `.env.avaliacao` (fora do git). Nunca imprime a chave,
 * as mensagens dos casos nem as respostas: só o nome do caso e o motivo da falha.
 * Opções: `--caso=trecho` roda só os casos cujo nome contém o trecho. Saída 0 = tudo passou, 1 = falhou, 2 = sem configuração.
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
    const filtro = process.argv.find((a) => a.startsWith("--caso="))?.slice("--caso=".length);
    const llm = new LlmAnthropic();
    const rel = await avaliar(llm, {
        filtro,
        aoTerminarCaso: (r) => console.log(`${r.passou ? "OK   " : "FALHA"} [${r.categoria}] ${r.nome}${r.motivo ? ` - ${r.motivo}` : ""}`),
    });
    console.log(`\n${resumo(rel)}`);
    process.exit(rel.passaram === rel.total ? 0 : 1);
}

main().catch((e) => {
    console.error(`Erro: ${(e as { name?: string })?.name ?? "erro"}`);
    process.exit(2);
});
