import { formatarDuracao } from "./formato";
import type { VariacaoMetrica } from "./calcular";

/** Texto do resumo mensal para colar no WhatsApp. Só números agregados: nunca nomes, telefones nem identificadores de conversa. */

function textoVariacao(v: VariacaoMetrica): string {
    if (v.variacaoPct === null) return "sem base de comparação";
    if (v.variacaoPct === 0) return "sem mudança";
    return `${v.variacaoPct > 0 ? "+" : "-"}${Math.abs(v.variacaoPct)}%`;
}

/** Texto livre que vai para o resumo não pode carregar JID nem telefone. */
function limpar(texto: string): string {
    return texto
        .replace(/\S*@\S+/g, "")
        .replace(/\+?\d[\d\s().-]{8,}\d/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

export function gerarResumoWhatsApp(args: {
    negocio: string;
    mes: string;
    vocabulario: { cliente: string; clientes: string };
    comparacao: Record<string, VariacaoMetrica>;
    /** Com o que as variações foram calculadas, ex.: "setembro de 2026". Padrão: período anterior de mesma duração. */
    comparadoCom?: string;
}): string {
    const { comparacao } = args;
    const negocio = limpar(args.negocio);
    const mes = limpar(args.mes);
    const vocabulario = { cliente: limpar(args.vocabulario.cliente), clientes: limpar(args.vocabulario.clientes) };
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
        ...(comparacao.vendasFechadas && (comparacao.vendasFechadas.atual > 0 || comparacao.vendasFechadas.anterior > 0) ? [linha("Vendas fechadas pela IA", "vendasFechadas")] : []),
        "",
        `Comparado com ${limpar(args.comparadoCom ?? "o período anterior de mesma duração")}.`,
    ].join("\n");
}

const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
