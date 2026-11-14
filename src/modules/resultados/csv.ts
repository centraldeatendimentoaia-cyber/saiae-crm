import type { Funil } from "./funil";
import { ROTULO_CONFIANCA_ORIGEM, ROTULO_ORIGEM, ROTULO_TIPO } from "./tipos";

/** Neutraliza injeção de fórmula: célula que começa com = + - @ (ou tab/CR) ganha apóstrofo na frente. Aspas, separador e quebras são escapados. */
export function celulaSegura(valor: unknown): string {
    let s = valor === null || valor === undefined ? "" : String(valor);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV do funil por etapa e origem. Separador ";" e BOM, como o CSV de métricas. Confirmado, inferido e desconhecido (do evento) em colunas separadas; a confiança da origem é uma coluna própria. */
export function csvFunil(funil: Funil): string {
    const cab = ["etapa", "origem", "confianca_da_origem", "confirmado", "inferido", "desconhecido"];
    const linhas: string[][] = [];
    for (const l of funil.linhas) {
        for (const o of l.porOrigem) {
            const c = o.contagem;
            linhas.push([ROTULO_TIPO[l.tipo], ROTULO_ORIGEM[o.origem], ROTULO_CONFIANCA_ORIGEM[o.confiancaOrigem], String(c.confirmado), String(c.inferido), String(c.desconhecido)]);
        }
    }
    return "﻿" + [cab, ...linhas].map((r) => r.map(celulaSegura).join(";")).join("\r\n") + "\r\n";
}
