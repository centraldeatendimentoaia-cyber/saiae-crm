import type { ZodError } from "zod";
import { GATILHOS_PADRAO_IDS, LIMITE_BASE_ITENS, LIMITE_BASE_TOTAL, LIMITE_EXEMPLOS, LIMITE_GATILHOS, LIMITE_OBJECOES, TreinoSchema, type Treino } from "./treino";

/** Funções puras que a tela de treino usa para editar o rascunho (sem React, testáveis em node). */

export const removerEm = <T>(lista: readonly T[], i: number): T[] => lista.filter((_, k) => k !== i);

export const atualizarEm = <T>(lista: readonly T[], i: number, patch: Partial<T>): T[] =>
    lista.map((x, k) => (k === i ? { ...x, ...patch } : x));

export const novaBase = (hoje: Date = new Date()): Treino["base"][number] => ({ titulo: "", texto: "", atualizadoEm: hoje.toISOString().slice(0, 10) });
export const novaEtapa = (): Treino["roteiro"]["etapas"][number] => ({ nome: "", instrucao: "" });
export const novaObjecao = (): Treino["objecoes"][number] => ({ cliente: "", resposta: "", proximoPasso: "" });
export const novoExemplo = (): Treino["exemplos"][number] => ({ cliente: "", ideal: "" });

export const podeAdicionarObjecao = (t: Treino) => t.objecoes.length < LIMITE_OBJECOES;
export const podeAdicionarExemplo = (t: Treino) => t.exemplos.length < LIMITE_EXEMPLOS;
export const podeAdicionarGatilho = (t: Treino) => t.gatilhos.length < LIMITE_GATILHOS;
/** Os gatilhos padrão só podem ser desligados ou editados; só os extras saem da lista. */
export const podeRemoverGatilho = (id: string) => !GATILHOS_PADRAO_IDS.includes(id);

/** Gatilho extra com id único (extra-1, extra-2...), desligado até o dono escrever a frase. */
export function novoGatilho(existentes: readonly { id: string }[]): Treino["gatilhos"][number] {
    const usados = new Set(existentes.map((g) => g.id));
    let n = 1;
    while (usados.has(`extra-${n}`)) n++;
    return { id: `extra-${n}`, ativo: false, descricao: "", frase: "" };
}

/** Mensagem única em PT-BR para o primeiro problema do treino, com o caminho do campo. */
export function mensagemErroTreino(e: ZodError): string {
    const i = e.issues[0];
    const onde = i?.path.length ? ` (${i.path.map((p) => (typeof p === "number" ? p + 1 : p)).join(" > ")})` : "";
    return `Treino inválido: ${i?.message ?? "dados inválidos"}${onde}`;
}

/** null = pode salvar; senão o texto do problema. */
export function validarTreino(t: Treino): string | null {
    const r = TreinoSchema.safeParse(t);
    return r.success ? null : mensagemErroTreino(r.error);
}

/** Indicador de alterações não salvas. */
export const temAlteracoes = (atual: Treino | null, salvo: Treino | null): boolean =>
    atual !== null && JSON.stringify(atual) !== JSON.stringify(salvo);

/**
 * Acrescenta uma sugestão aprovada ao treino, sem mutar o original. Devolve o treino novo, ou o texto do problema quando
 * passaria de um limite (nesse caso nada muda).
 */
export function aplicarSugestao(t: Treino, s: { cliente: string; resposta: string }, destino: "exemplo" | "base", hoje: Date = new Date()): Treino | string {
    if (destino === "exemplo") {
        if (!podeAdicionarExemplo(t)) return `O treino já tem o máximo de ${LIMITE_EXEMPLOS} exemplos. Remova um no rascunho antes de aprovar.`;
        return { ...t, exemplos: [...t.exemplos, { cliente: s.cliente, ideal: s.resposta }] };
    }
    const total = t.base.reduce((soma, b) => soma + b.texto.length, 0);
    if (t.base.length >= LIMITE_BASE_ITENS || total + s.resposta.length > LIMITE_BASE_TOTAL) {
        return `A base de conhecimento já está no máximo (${LIMITE_BASE_ITENS} itens ou ${LIMITE_BASE_TOTAL} caracteres). Enxugue a base no rascunho antes de aprovar.`;
    }
    return { ...t, base: [...t.base, { ...novaBase(hoje), titulo: "Correção da equipe", texto: s.resposta }] };
}

/** Desfecho: trocar o tipo mantém o link só quando é "link". */
export function trocarDesfecho(t: Treino, tipo: "link" | "pessoa", link = ""): Treino {
    return { ...t, roteiro: { ...t.roteiro, desfecho: tipo === "link" ? { tipo, link } : { tipo } } };
}

/**
 * Controle de respostas atrasadas da tela. Carga (GET) e ações (salvar, publicar, voltar) têm contadores separados:
 * recarregar depois de uma ação não pode invalidar a própria ação (senão a tela ficaria travada), mas uma resposta de
 * outra sessão é sempre descartada.
 */
export function criarGuardaSessao() {
    let sessao: string | null = null;
    let carga = 0;
    return {
        /** Chamar ao entrar numa sessão (e na troca). Invalida tudo o que estava em voo. */
        trocar(id: string | null) {
            sessao = id;
            carga++;
        },
        iniciarCarga: () => ++carga,
        cargaVigente: (ticket: number) => ticket === carga,
        /** Ação em voo: vigente enquanto a sessão não mudou, mesmo que ocorram recargas no meio. */
        iniciarAcao() {
            const minha = sessao;
            return { vigente: () => sessao === minha };
        },
    };
}
