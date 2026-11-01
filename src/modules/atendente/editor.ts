import type { ZodError } from "zod";
import { LIMITE_EXEMPLOS, LIMITE_GATILHOS, LIMITE_OBJECOES, TreinoSchema, type Treino } from "./treino";

/** Funções puras que a tela de treino usa para editar o rascunho (sem React, testáveis em node). */

export const GATILHOS_PADRAO_IDS: readonly string[] = ["reclamacao", "desconto", "pedido-humano", "assunto-sensivel", "audio", "sem-avanco"];

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

/** Desfecho: trocar o tipo mantém o link só quando é "link". */
export function trocarDesfecho(t: Treino, tipo: "link" | "pessoa", link = ""): Treino {
    return { ...t, roteiro: { ...t.roteiro, desfecho: tipo === "link" ? { tipo, link } : { tipo } } };
}
