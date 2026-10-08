/** Argumentos de `npm run ia:avaliar`: `--caso=trecho[,trecho]`, `--grupo=lojas|vendas` e `--modelo=nome-do-modelo`. Sem dependências (testável). */
export interface ArgsAvaliar {
    caso?: string;
    modelo?: string;
    /** "lojas" ou "vendas": roda só os casos desse grupo. */
    grupo?: "lojas" | "vendas";
}

export function lerArgs(argv: string[]): ArgsAvaliar {
    const pega = (nome: string) => {
        const a = argv.find((x) => x.startsWith(`--${nome}=`));
        const v = a?.slice(nome.length + 3).trim();
        return v || undefined;
    };
    const modelo = pega("modelo");
    const grupo = pega("grupo");
    return { caso: pega("caso"), grupo: grupo === "lojas" || grupo === "vendas" ? grupo : undefined, modelo: modelo && /^[A-Za-z0-9._-]{3,80}$/.test(modelo) ? modelo : undefined };
}
