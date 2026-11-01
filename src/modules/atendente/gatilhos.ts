import type { Treino } from "./treino";

/**
 * Regras puras (sem I/O, sem LLM) que decidem se a conversa deve passar para uma pessoa. O texto vem do cliente, então
 * nada aqui monta regex a partir dele: a busca é por `includes` de palavras já normalizadas, o que é linear.
 *
 * O schema do Treino não tem campo de palavras-chave; por isso as listas abaixo valem só para os ids padrão de
 * modelos-prontos.ts. Gatilhos criados pelo dono (ids fora desta tabela) são ignorados aqui: quem os avalia é o
 * classificador de LLM (Task 11). O gatilho "audio" também fica sem lista, porque esta função só vê texto; o motor
 * (Task 12) decide chamar a pessoa quando o áudio não é entendido.
 */

/** Palavras e frases por id de gatilho padrão. Reaproveitável pelo classificador (Task 11) e pelo motor (Task 13). */
export const PALAVRAS_PADRAO: Readonly<Record<string, readonly string[]>> = {
    "pedido-humano": [
        "falar com uma pessoa", "falar com pessoa", "falar com um humano", "falar com humano", "falar com um atendente",
        "falar com atendente", "falar com o gerente", "falar com a gerente", "falar com gerente", "falar com o responsavel",
        "falar com a responsavel", "falar com responsavel", "quero um atendente", "quero uma pessoa", "quero um humano",
        "quero atendente", "me passa um atendente", "me passa para um atendente", "atendente humano", "atendimento humano",
    ],
    reclamacao: [
        "reclamacao", "reclamar", "pessimo", "pessima", "absurdo", "procon", "vou processar", "indignado", "indignada",
        "golpe", "enganado", "enganada",
    ],
    "assunto-sensivel": [
        // saúde
        "alergia", "alergica", "alergico", "gravida", "gestante", "remedio", "medicacao", "diagnostico", "doenca",
        "tratamento medico",
        // jurídico
        "advogado", "advogada", "processo", "justica", "indenizacao",
    ],
};

// Pedido de desconto/negociação. Com valorLimite, qualquer uma destas mais um número acima do limite chama a pessoa.
const PALAVRAS_DESCONTO = ["desconto", "mais barato", "abaixa o preco", "abaixar o preco", "faz por", "negociar", "negociacao"];
// Sem valorLimite não há como saber o que é "fora da regra"; só a negociação explícita chama a pessoa.
const NEGOCIACAO_EXPLICITA = ["negociar", "negociacao", "desconto especial", "condicao especial"];

/** Minúsculas, sem acento, só letras/dígitos separados por um espaço, com espaço nas pontas (fronteira de palavra). */
const normalizar = (s: string) => ` ${s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

const ehGatilho = (padded: string, palavras: readonly string[]) => palavras.some((p) => padded.includes(normalizar(p)));

/** Maior número do texto, aceitando "1500", "1.500", "1.500,00" e "99,90". Regex linear, sem backtracking aninhado. */
const maiorNumero = (texto: string): number => {
    let maior = -1;
    for (const m of texto.matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g)) {
        const n = Number(m[0].replace(/\.(?=\d{3}(?!\d))/g, "").replace(",", "."));
        if (Number.isFinite(n) && n > maior) maior = n;
    }
    return maior;
};

/**
 * Ordem de prioridade quando vários gatilhos casam; só o primeiro é devolvido:
 * assunto sensível > reclamação > pedido de humano > desconto > insistência (três mensagens sem avançar).
 * Gatilhos desligados são ignorados. `valorLimite` está na mesma unidade do número escrito pelo cliente (reais ou %).
 */
export function deveChamarPessoa(args: {
    texto: string;
    mensagensSemAvancar: number;
    gatilhos: Treino["gatilhos"];
    valorLimite?: number;
}): { chamar: boolean; gatilhoId?: string; frase?: string } {
    const { texto, mensagensSemAvancar, gatilhos, valorLimite } = args;
    const padded = normalizar(texto);
    const ativo = (id: string) => gatilhos.find((g) => g.id === id && g.ativo);

    const casa: [string, () => boolean][] = [
        ["assunto-sensivel", () => ehGatilho(padded, PALAVRAS_PADRAO["assunto-sensivel"])],
        ["reclamacao", () => ehGatilho(padded, PALAVRAS_PADRAO.reclamacao)],
        ["pedido-humano", () => ehGatilho(padded, PALAVRAS_PADRAO["pedido-humano"])],
        [
            "desconto",
            () =>
                valorLimite === undefined
                    ? ehGatilho(padded, NEGOCIACAO_EXPLICITA)
                    : ehGatilho(padded, PALAVRAS_DESCONTO) && maiorNumero(texto) > valorLimite,
        ],
        ["sem-avanco", () => mensagensSemAvancar >= 3],
    ];

    for (const [id, confere] of casa) {
        const g = ativo(id);
        if (g && confere()) return { chamar: true, gatilhoId: g.id, frase: g.frase };
    }
    return { chamar: false };
}
