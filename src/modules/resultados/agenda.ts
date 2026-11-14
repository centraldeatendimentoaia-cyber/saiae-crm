import { createHash } from "node:crypto";
import { z } from "zod";
import { ORIGENS, TIPOS_IMPORTAVEIS, type Origem, type TipoImportavel } from "./tipos";

/**
 * Importação controlada de agenda/vendas (CSV ou JSON enviado pelo usuário). Núcleo puro: valida, normaliza e gera a chave de
 * idempotência. Não fala com agenda real nem com banco. Colunas: tipo, contato, ocorrido_em, origem (opc.), campanha (opc.),
 * referencia (opc.), valor (opc., em reais), fonte_conferida (opc.: "sim" só se a linha foi conferida com agenda ou caixa; sem isso a linha é INFERIDA).
 */

export const MAX_BYTES_IMPORTACAO = 1_000_000;
export const MAX_LINHAS_IMPORTACAO = 5000;

export interface EventoImportado {
    tipo: TipoImportavel;
    contactKey: string;
    ocorridoEm: Date;
    origem: Origem | null;
    origemDetalhe: string | null;
    refExterna: string | null;
    valorCentavos: number | null;
    dedupKey: string;
    /** "confirmado" só quando a linha declara fonte_conferida; senão "inferido" (a planilha é declaração do usuário, não verificada). */
    confianca: "confirmado" | "inferido";
}
export interface Rejeicao { linha: number; motivo: string }
export interface ResultadoParse {
    eventos: EventoImportado[];
    rejeitadas: Rejeicao[];
    recebidas: number;
    /** Linhas descartadas por serem repetidas dentro do próprio arquivo (também aparecem em rejeitadas). */
    repetidasNoArquivo: number;
    /** Quantas dessas repetidas não tinham "referencia": podem ser vendas distintas do mesmo dia juntadas. */
    repetidasSemReferencia: number;
    avisos: string[];
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Telefone → jid. 10 ou 11 dígitos ganham o prefixo 55 (Brasil); 12 a 15 dígitos ficam como estão. Fora disso, lixo. */
export function normalizarContato(bruto: string): string | null {
    const t = bruto.trim();
    if (/^\d{10,15}@s\.whatsapp\.net$/.test(t)) return t;
    const d = t.replace(/[\s().+-]/g, "");
    if (!/^\d+$/.test(d)) return null;
    if (d.length === 10 || d.length === 11) return `55${d}@s.whatsapp.net`;
    if (d.length >= 12 && d.length <= 15) return `${d}@s.whatsapp.net`;
    return null;
}

/** "AAAA-MM-DD" (meio-dia de São Paulo) ou ISO completo. Datas inexistentes (31/02) são recusadas. */
export function lerData(bruto: string): Date | null {
    const t = bruto.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
        const d = new Date(`${t}T12:00:00.000-03:00`);
        return Number.isNaN(d.getTime()) || new Date(d.getTime() - 9 * 3_600_000).toISOString().slice(0, 10) !== t ? null : d;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(t);
    if (!m) return null;
    // O JavaScript normaliza 31/02 para 3/03 e aceita hora 24: confere os componentes de calendário antes de converter.
    const [ano, mes, dia, hora, min, seg, offH, offM] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0", m[7] ?? "0", m[8] ?? "0"].map(Number);
    const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate(); // dia 0 do mês seguinte = último dia deste (mes de 1 a 12)
    if (mes < 1 || mes > 12 || dia < 1 || dia > diasNoMes || hora > 23 || min > 59 || seg > 59 || offH > 23 || offM > 59) return null;
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
}

function lerValor(bruto: string): number | null | "invalido" | "ambiguo" {
    const t = bruto.trim();
    if (!t) return null;
    // "1.234" pode ser 1234 (milhar BR) ou 1,234: não adivinhamos dinheiro
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) return "ambiguo";
    const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
    return Number.isFinite(n) && n >= 0 && n < 10_000_000 ? Math.round(n * 100) : "invalido";
}

export function chaveDedup(e: { tipo: string; contactKey: string; ocorridoEm: Date; refExterna: string | null }): string {
    // Hash dos identificadores EXATOS: a coluna usa collation insensível a maiúsculas, e a referência literal faria "PedidoA" e
    // "pedidoa" colidirem no banco. Hex minúsculo mantém a unicidade igual com ou sem collation e cabe no índice (66 caracteres).
    if (e.refExterna) return "r:" + createHash("sha256").update(JSON.stringify([e.tipo, e.contactKey, e.refExterna])).digest("hex");
    return "h:" + createHash("sha256").update(`${e.tipo}|${e.contactKey}|${e.ocorridoEm.toISOString()}`).digest("hex").slice(0, 32);
}

const linhaSchema = z.object({
    tipo: z.string(),
    contato: z.string(),
    ocorrido_em: z.string(),
    origem: z.string().optional().default(""),
    campanha: z.string().optional().default(""),
    referencia: z.string().optional().default(""),
    valor: z.string().optional().default(""),
    fonte_conferida: z.string().optional().default(""),
});

function validarLinha(bruta: Record<string, unknown>, agora: Date): { ok: true; evento: EventoImportado } | { ok: false; motivo: string } {
    const texto: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(bruta)) texto[k] = v === null || v === undefined ? undefined : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : v;
    const r = linhaSchema.safeParse(texto);
    if (!r.success) return { ok: false, motivo: "campos obrigatórios ausentes ou com tipo inválido (tipo, contato, ocorrido_em)" };
    const l = r.data;
    const tipo = semAcento(l.tipo) as TipoImportavel;
    if (!(TIPOS_IMPORTAVEIS as readonly string[]).includes(tipo)) return { ok: false, motivo: `tipo inválido "${l.tipo.slice(0, 40)}" (use ${TIPOS_IMPORTAVEIS.join(", ")})` };
    const contactKey = normalizarContato(l.contato);
    if (!contactKey) return { ok: false, motivo: "contato inválido (use telefone com DDD)" };
    const ocorridoEm = lerData(l.ocorrido_em);
    if (!ocorridoEm) return { ok: false, motivo: "data inválida (use AAAA-MM-DD ou ISO 8601)" };
    // comparecimento e venda são fatos já ocorridos: data futura é lixo; agendamentos podem ser futuros
    if ((tipo === "comparecimento" || tipo === "venda") && ocorridoEm.getTime() > agora.getTime() + 86_400_000) return { ok: false, motivo: `${tipo} com data futura` };
    if (ocorridoEm.getTime() < Date.UTC(2020, 0, 1)) return { ok: false, motivo: "data anterior a 2020" };
    const origemTxt = semAcento(l.origem);
    let origem: Origem | null = null;
    if (origemTxt) {
        if (!(ORIGENS as readonly string[]).includes(origemTxt) || origemTxt === "desconhecido") return { ok: false, motivo: `origem inválida "${l.origem.slice(0, 40)}" (use ${ORIGENS.filter((o) => o !== "desconhecido").join(", ")} ou deixe em branco)` };
        origem = origemTxt as Origem;
    }
    const valor = lerValor(l.valor);
    if (valor === "invalido") return { ok: false, motivo: "valor inválido" };
    if (valor === "ambiguo") return { ok: false, motivo: 'valor ambíguo (use "1234,00" ou "1234.50", sem separador de milhar)' };
    const conferida = semAcento(l.fonte_conferida);
    if (!["", "sim", "nao", "true", "false", "1", "0"].includes(conferida)) return { ok: false, motivo: 'fonte_conferida inválida (use "sim" ou "nao", ou deixe em branco)' };
    const refExterna = l.referencia.trim().slice(0, 100) || null;
    // controle e quebras de linha não entram em texto livre
    const detalhe = l.campanha.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120) || null;
    const base = { tipo, contactKey, ocorridoEm, refExterna };
    return { ok: true, evento: { ...base, origem, origemDetalhe: detalhe, valorCentavos: valor, dedupKey: chaveDedup(base), confianca: ["sim", "true", "1"].includes(conferida) ? "confirmado" : "inferido" } };
}

/** CSV simples com aspas. Separador detectado pelo cabeçalho (";" ou ","). */
export function lerCsv(texto: string): string[][] {
    return lerCsvDetalhado(texto).linhas;
}

/** Igual a lerCsv, mas diz se o arquivo terminou dentro de aspas abertas (aspa solta: as linhas seguintes foram engolidas). */
export function lerCsvDetalhado(texto: string): { linhas: string[][]; aspaAberta: boolean } {
    const t = texto.replace(/^﻿/, "");
    const primeira = t.split(/\r?\n/, 1)[0] ?? "";
    const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) && primeira.includes(";") ? ";" : ",";
    const linhas: string[][] = [];
    let cel = "";
    let linha: string[] = [];
    let aspas = false;
    for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (aspas) {
            if (c === '"' && t[i + 1] === '"') { cel += '"'; i++; }
            else if (c === '"') aspas = false;
            else cel += c;
        } else if (c === '"') aspas = true;
        else if (c === sep) { linha.push(cel); cel = ""; }
        else if (c === "\n" || c === "\r") {
            if (c === "\r" && t[i + 1] === "\n") i++;
            linha.push(cel); cel = "";
            if (linha.some((x) => x.trim() !== "")) linhas.push(linha);
            linha = [];
        } else cel += c;
    }
    linha.push(cel);
    if (linha.some((x) => x.trim() !== "")) linhas.push(linha);
    return { linhas, aspaAberta: aspas };
}

/** Valida o arquivo inteiro. Linhas ruins são rejeitadas com o número da linha; as boas seguem. Duplicatas dentro do arquivo são descartadas. */
export function interpretarImportacao(formato: "csv" | "json", conteudo: string, agora = new Date()): { ok: true; resultado: ResultadoParse } | { ok: false; mensagem: string } {
    if (Buffer.byteLength(conteudo, "utf8") > MAX_BYTES_IMPORTACAO) return { ok: false, mensagem: "Arquivo grande demais (máximo 1 MB)." };
    const avisos: string[] = [];
    let brutas: { numero: number; dados: Record<string, unknown> }[];
    if (formato === "csv") {
        const det = lerCsvDetalhado(conteudo);
        const linhas = det.linhas;
        if (det.aspaAberta) avisos.push('O CSV termina dentro de aspas abertas ("): linhas podem ter sido unidas ou perdidas. Revise o arquivo.');
        if (conteudo.includes("�")) avisos.push("O arquivo tem caracteres inválidos: provavelmente não está em UTF-8 (ex.: Windows-1252). Salve como CSV UTF-8 e importe de novo.");
        if (linhas.length < 2) return { ok: false, mensagem: "O CSV precisa de cabeçalho e ao menos uma linha." };
        const cab = linhas[0].map((c) => semAcento(c).replace(/\s+/g, "_"));
        for (const obrig of ["tipo", "contato", "ocorrido_em"]) if (!cab.includes(obrig)) return { ok: false, mensagem: `Cabeçalho sem a coluna "${obrig}". Colunas: tipo, contato, ocorrido_em, origem, campanha, referencia, valor.` };
        brutas = linhas.slice(1).map((cols, i) => ({ numero: i + 2, dados: Object.fromEntries(cab.map((c, j) => [c, cols[j] ?? ""])) }));
    } else {
        let json: unknown;
        try { json = JSON.parse(conteudo); } catch { return { ok: false, mensagem: "JSON inválido." }; }
        const lista = Array.isArray(json) ? json : json && typeof json === "object" && Array.isArray((json as { eventos?: unknown }).eventos) ? (json as { eventos: unknown[] }).eventos : null;
        if (!lista) return { ok: false, mensagem: 'O JSON deve ser uma lista ou um objeto { "eventos": [...] }.' };
        brutas = lista.map((d, i) => ({ numero: i + 1, dados: d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : {} }));
    }
    if (brutas.length === 0) return { ok: false, mensagem: "Nenhuma linha para importar." };
    if (brutas.length > MAX_LINHAS_IMPORTACAO) return { ok: false, mensagem: `Muitas linhas (máximo ${MAX_LINHAS_IMPORTACAO}).` };
    const eventos: EventoImportado[] = [];
    const rejeitadas: Rejeicao[] = [];
    const vistos = new Set<string>();
    let repetidasNoArquivo = 0;
    let repetidasSemReferencia = 0;
    for (const b of brutas) {
        const r = validarLinha(b.dados, agora);
        if (!r.ok) { rejeitadas.push({ linha: b.numero, motivo: r.motivo }); continue; }
        if (vistos.has(r.evento.dedupKey)) {
            repetidasNoArquivo++;
            if (!r.evento.refExterna) repetidasSemReferencia++;
            rejeitadas.push({ linha: b.numero, motivo: r.evento.refExterna ? "duplicada no próprio arquivo" : "repetida no arquivo (mesmo tipo, contato e data, sem referência)" });
            continue;
        }
        vistos.add(r.evento.dedupKey);
        eventos.push(r.evento);
    }
    if (repetidasSemReferencia > 0) avisos.push(`${repetidasSemReferencia} linha(s) sem "referencia" repetem tipo, contato e data de outra e foram ignoradas. Se são vendas distintas no mesmo dia, informe a coluna "referencia" em cada uma.`);
    return { ok: true, resultado: { eventos, rejeitadas, recebidas: brutas.length, repetidasNoArquivo, repetidasSemReferencia, avisos } };
}
