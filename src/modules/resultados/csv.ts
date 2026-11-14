import type { Funil } from "./funil";
import { ORIGENS, ROTULO_ORIGEM, ROTULO_TIPO } from "./tipos";

/** Neutraliza injeção de fórmula: célula que começa com = + - @ (ou tab/CR) ganha apóstrofo na frente. Aspas, separador e quebras são escapados. */
export function celulaSegura(valor: unknown): string {
    let s = valor === null || valor === undefined ? "" : String(valor);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV do funil por etapa e origem. Separador ";" e BOM, como o CSV de métricas. Confirmado, inferido e desconhecido em colunas separadas. */
export function csvFunil(funil: Funil): string {
    const cab = ["etapa", "origem", "confirmado", "inferido", "desconhecido"];
    const linhas: string[][] = [];
    for (const l of funil.linhas) {
        for (const o of ORIGENS) {
            const c = l.porOrigem[o];
            linhas.push([ROTULO_TIPO[l.tipo], ROTULO_ORIGEM[o], String(c.confirmado), String(c.inferido), String(c.desconhecido)]);
        }
    }
    return "﻿" + [cab, ...linhas].map((r) => r.map(celulaSegura).join(";")).join("\r\n") + "\r\n";
}
