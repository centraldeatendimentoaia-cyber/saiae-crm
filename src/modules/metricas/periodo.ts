import { z } from "zod";
import type { Expediente, MetricasDia } from "./calcular";

/** Funções puras de apoio à rota de métricas: período, expediente e CSV. */

export const MAX_DIAS_PERIODO = 92;

const dataValida = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use datas no formato AAAA-MM-DD.")
    .refine((s) => {
        const d = new Date(`${s}T12:00:00Z`);
        return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }, "Data inexistente.");

export const consultaMetricas = z.object({
    de: dataValida,
    ate: dataValida,
});

export interface Periodo {
    de: string;
    ate: string;
    inicio: Date;
    fim: Date;
    dias: number;
}

/** Valida o período (datas de São Paulo, inclusive nas duas pontas). Devolve a mensagem de erro em PT-BR quando inválido. */
export function lerPeriodo(params: { de: string | null; ate: string | null }): { ok: true; periodo: Periodo } | { ok: false; mensagem: string } {
    const r = consultaMetricas.safeParse({ de: params.de ?? undefined, ate: params.ate ?? undefined });
    if (!r.success) {
        const faltando = !params.de || !params.ate;
        return { ok: false, mensagem: faltando ? "Informe o período com ?de=AAAA-MM-DD&ate=AAAA-MM-DD." : r.error.issues[0]?.message || "Período inválido." };
    }
    const { de, ate } = r.data;
    if (ate < de) return { ok: false, mensagem: "A data final não pode ser anterior à inicial." };
    const dias = Math.round((new Date(`${ate}T12:00:00Z`).getTime() - new Date(`${de}T12:00:00Z`).getTime()) / 86_400_000) + 1;
    if (dias > MAX_DIAS_PERIODO) return { ok: false, mensagem: `O período pode ter no máximo ${MAX_DIAS_PERIODO} dias.` };
    return {
        ok: true,
        periodo: { de, ate, dias, inicio: new Date(`${de}T00:00:00.000-03:00`), fim: new Date(`${ate}T23:59:59.999-03:00`) },
    };
}

export const EXPEDIENTE_PADRAO: Expediente = { dias: [1, 2, 3, 4, 5], horaAbre: 9, horaFecha: 18 };

/** Expediente a partir do AgenteConfig da sessão ("2,3,4,5,6" = terça a sábado). Sem configuração: segunda a sexta, 9h às 18h. */
export function expedienteDe(cfg: { diasAbertos: string; horaAbre: number; horaFecha: number } | null | undefined): Expediente {
    if (!cfg) return { ...EXPEDIENTE_PADRAO, dias: [...EXPEDIENTE_PADRAO.dias] };
    const dias = cfg.diasAbertos
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    return { dias, horaAbre: cfg.horaAbre, horaFecha: cfg.horaFecha };
}

/** CSV da série diária. Separador ";" e BOM, para abrir direto no Excel em português. */
export function csvPorDia(linhas: MetricasDia[]): string {
    const cab = ["dia", "mensagens_recebidas", "demandas", "sem_retorno", "tempo_mediano_primeira_resposta_segundos"];
    const corpo = linhas.map((l) => [l.dia, l.recebidas, l.demandas, l.semRetorno, l.tempoMediano ?? ""].join(";"));
    return "﻿" + [cab.join(";"), ...corpo].join("\r\n") + "\r\n";
}
