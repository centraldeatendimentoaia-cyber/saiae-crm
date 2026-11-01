import { formatarDuracao } from "./formato";
import type { VariacaoMetrica } from "./calcular";

/** Texto do resumo mensal para colar no WhatsApp. Só números agregados: nunca nomes, telefones nem identificadores de conversa. */

function textoVariacao(v: VariacaoMetrica): string {
    if (v.variacaoPct === null) return "sem base de comparação";
    if (v.variacaoPct === 0) return "sem mudança";
    return `${v.variacaoPct > 0 ? "+" : "-"}${Math.abs(v.variacaoPct)}%`;
}

export function gerarResumoWhatsApp(args: {
    negocio: string;
    mes: string;
    vocabulario: { cliente: string; clientes: string };
    comparacao: Record<string, VariacaoMetrica>;
}): string {
    const { negocio, mes, vocabulario, comparacao } = args;
    const linha = (rotulo: string, chave: string, formatar: (n: number) => string = String) => {
        const v = comparacao[chave];
        if (!v) return `- ${rotulo}: sem dados`;
        return `- ${rotulo}: ${formatar(v.atual)} (${textoVariacao(v)})`;
    };
    // mediana 0 significa "sem respostas no período" (compararPeriodos troca null por 0)
    const tempo = comparacao.tempoMedianoPrimeiraResposta;
    const linhaTempo = !tempo || tempo.atual === 0 ? "- Tempo de primeira resposta: sem dados" : linha("Tempo de primeira resposta", "tempoMedianoPrimeiraResposta", formatarDuracao);

    return [
        `*Resumo de ${mes} - ${negocio}*`,
        "",
        linha(`${capitalizar(vocabulario.clientes)} novos`, "contatosNovos"),
        linha(`${capitalizar(vocabulario.clientes)} de anúncio`, "clientesDeAnuncio"),
        linha(`${capitalizar(vocabulario.clientes)} reativados`, "reativados"),
        linhaTempo,
        linha("Sem retorno", "demandasSemRetorno"),
        "",
        "Variação em relação ao período anterior de mesma duração.",
    ].join("\n");
}

const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
