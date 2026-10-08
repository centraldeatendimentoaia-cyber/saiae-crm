/** Argumentos de `npm run ia:avaliar`: `--caso=trecho` e `--modelo=nome-do-modelo`. Sem dependências (testável). */
export interface ArgsAvaliar {
    caso?: string;
    modelo?: string;
}

export function lerArgs(argv: string[]): ArgsAvaliar {
    const pega = (nome: string) => {
        const a = argv.find((x) => x.startsWith(`--${nome}=`));
        const v = a?.slice(nome.length + 3).trim();
        return v || undefined;
    };
    const modelo = pega("modelo");
    return { caso: pega("caso"), modelo: modelo && /^[A-Za-z0-9._-]{3,80}$/.test(modelo) ? modelo : undefined };
}
