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

// "falar com" x artigo x pessoa, para não listar cada combinação à mão.
const FALAR_COM = ["falar com", "conversar com"].flatMap((v) =>
    ["", "a ", "o ", "um ", "uma "].flatMap((art) =>
        ["pessoa", "humano", "atendente", "gerente", "responsavel", "dono", "dona", "alguem"].map((alvo) => `${v} ${art}${alvo}`),
    ),
);

/**
 * Palavras e frases por id de gatilho padrão. Reaproveitável pelo classificador (Task 11) e pelo motor (Task 13).
 * Escolha consciente de segurança: "alergia", "gravida" e "remedio" chamam uma pessoa mesmo em conversa comercial,
 * porque errar para o lado de passar a conversa é mais barato do que a IA opinar sobre saúde.
 */
export const PALAVRAS_PADRAO: Readonly<Record<string, readonly string[]>> = {
    "pedido-humano": [
        ...FALAR_COM, "pessoa de verdade", "alguem de verdade", "quero um atendente", "quero atendente", "quero uma pessoa",
        "quero um humano", "me passa um atendente", "me passa para um atendente", "me passa para uma pessoa", "chama um atendente",
        "chama uma pessoa", "atendente humano", "atendimento humano", "quero ser atendido por uma pessoa",
        "nao quero falar com robo", "nao quero conversar com robo", "nao quero falar com bot", "nao quero falar com maquina",
    ],
    reclamacao: [
        "reclamacao", "reclamacoes", "reclamar", "reclamando", "reclamei", "atendimento pessimo", "servico pessimo",
        "pessimo atendimento", "pessimo servico", "fui mal atendido", "fui mal atendida", "absurdo", "procon", "vou processar",
        "processar", "processei", "indignado", "indignada", "golpe", "golpista", "enganado", "enganada", "fui enganado",
        "reembolso", "estorno", "nunca mais", "horrivel", "decepcionado", "decepcionada",
    ],
    "assunto-sensivel": [
        // saúde
        "alergia", "alergica", "alergico", "gravida", "gestante", "remedio", "medicacao", "diagnostico medico", "doenca",
        "tratamento medico",
        // jurídico
        "advogado", "advogada", "advogados", "processo judicial", "processo contra", "abrir processo", "entrar na justica",
        "justica", "indenizacao",
    ],
};

// Pedido de desconto/negociação; com valorLimite, junto de uma porcentagem acima do limite chama a pessoa.
const PALAVRAS_DESCONTO = ["desconto", "mais barato", "abaixa o preco", "abaixar o preco", "faz por", "negociar", "negociacao"];
// Negociação explícita chama a pessoa com ou sem valorLimite.
const NEGOCIACAO_EXPLICITA = ["negociar", "negociacao", "desconto especial", "condicao especial"];

/** Minúsculas, sem acento, só letras/dígitos separados por um espaço, com espaço nas pontas (fronteira de palavra). */
const normalizar = (s: string) => ` ${s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

// Tabelas normalizadas uma única vez, na carga do módulo.
const norm = (l: readonly string[]) => l.map(normalizar);
const NORMALIZADAS = Object.fromEntries(Object.entries(PALAVRAS_PADRAO).map(([id, l]) => [id, norm(l)]));
const DESCONTO_N = norm(PALAVRAS_DESCONTO);
const NEGOCIACAO_N = norm(NEGOCIACAO_EXPLICITA);

const contem = (padded: string, palavras: readonly string[]) => palavras.some((p) => padded.includes(p));

/**
 * Maior porcentagem escrita no texto ("15%", "12,5 %"). Só números com "%" contam: datas, horas e valores em reais
 * ("R$ 80", "1.200,50 reais") não são comparáveis com o limite, cuja unidade é porcentagem. Regex linear.
 */
const maiorPorcentagem = (texto: string): number => {
    let maior = -1;
    for (const m of texto.matchAll(/(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*%/g)) {
        const n = Number(m[1].replace(/\.(?=\d{3}(?!\d))/g, "").replace(",", "."));
        if (Number.isFinite(n) && n > maior) maior = n;
    }
    return maior;
};

/**
 * Ordem de prioridade quando vários gatilhos casam; só o primeiro é devolvido:
 * assunto sensível > reclamação > pedido de humano > desconto > insistência (três mensagens sem avançar).
 * Gatilhos desligados são ignorados. `valorLimite` é um limite em PORCENTAGEM de desconto.
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
        ["assunto-sensivel", () => contem(padded, NORMALIZADAS["assunto-sensivel"])],
        ["reclamacao", () => contem(padded, NORMALIZADAS.reclamacao)],
        ["pedido-humano", () => contem(padded, NORMALIZADAS["pedido-humano"])],
        [
            "desconto",
            () =>
                contem(padded, NEGOCIACAO_N) ||
                (valorLimite !== undefined && contem(padded, DESCONTO_N) && maiorPorcentagem(texto) > valorLimite),
        ],
        ["sem-avanco", () => mensagensSemAvancar >= 3],
    ];

    for (const [id, confere] of casa) {
        const g = ativo(id);
        if (g && confere()) return { chamar: true, gatilhoId: g.id, frase: g.frase };
    }
    return { chamar: false };
}
