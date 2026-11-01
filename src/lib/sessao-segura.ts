/** Só grava se os dados na tela foram carregados da sessão que está ativa agora. */
export function podeSalvar(sessionIdAtual: string, sessionIdDosDados: string | null, carregando: boolean): boolean {
    return !carregando && sessionIdDosDados !== null && sessionIdDosDados === sessionIdAtual;
}
