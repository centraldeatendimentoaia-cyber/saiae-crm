const execucoes = new Map<string, { quando: number; resultado: Promise<unknown> }>();

/**
 * Roda `fn` uma única vez por `chave` dentro da janela: repetições (duplo clique, Enter repetido, reenvio da
 * mesma requisição) recebem o resultado da primeira em vez de enviar a mensagem de novo.
 * Se a primeira falhar, a chave é liberada para uma nova tentativa.
 */
export function executarUmaVez<T>(chave: string, fn: () => Promise<T>, janelaMs = 60_000): Promise<T> {
    const agora = Date.now();
    for (const [k, v] of execucoes) if (agora - v.quando > janelaMs) execucoes.delete(k);

    const existente = execucoes.get(chave);
    if (existente) return existente.resultado as Promise<T>;

    const resultado = fn();
    execucoes.set(chave, { quando: agora, resultado });
    resultado.catch(() => execucoes.delete(chave));
    return resultado;
}
