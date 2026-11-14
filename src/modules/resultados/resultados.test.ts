import { describe, expect, it } from "vitest";
import { origemDaEtiqueta, resolverOrigem } from "./origem";
import { consolidarFunil } from "./funil";
import { celulaSegura, csvFunil } from "./csv";
import { interpretarImportacao, normalizarContato, lerData } from "./agenda";
import type { EventoResultado, OrigemResolvida } from "./tipos";

const DESC: OrigemResolvida = { origem: "desconhecido", confianca: "desconhecido", regra: "x" };
const ANUN: OrigemResolvida = { origem: "anuncio", confianca: "confirmado", regra: "x" };
const ev = (tipo: EventoResultado["tipo"], contato: string, confianca: EventoResultado["confianca"], origem = DESC): EventoResultado => ({ tipo, contato, quando: new Date("2026-11-01T12:00:00Z"), confianca, fonte: "teste", origem });

describe("origem", () => {
    it("classifica etiquetas de origem e ignora as de interesse/status", () => {
        expect(origemDaEtiqueta("Origem: Meta")).toBe("anuncio");
        expect(origemDaEtiqueta("Indicação")).toBe("indicacao");
        expect(origemDaEtiqueta("Google")).toBe("campanha");
        expect(origemDaEtiqueta("Orgânico")).toBe("organico");
        expect(origemDaEtiqueta("Corte")).toBeNull();
        expect(origemDaEtiqueta("Sumiu - follow up")).toBeNull();
    });
    it("marcador de anúncio é confirmado; orgânico e etiqueta são inferidos com a regra descrita", () => {
        expect(resolverOrigem({ conversaOrigem: "anuncio" })).toMatchObject({ origem: "anuncio", confianca: "confirmado" });
        const org = resolverOrigem({ conversaOrigem: "organico" });
        expect(org).toMatchObject({ origem: "organico", confianca: "inferido" });
        expect(org.regra).toMatch(/sem marcador/);
        expect(resolverOrigem({ etiquetas: ["Corte", "Indicação"] })).toMatchObject({ origem: "indicacao", confianca: "inferido" });
    });
    it("sem nenhuma fonte a origem é desconhecida, nunca chutada", () => {
        expect(resolverOrigem({})).toMatchObject({ origem: "desconhecido", confianca: "desconhecido" });
        expect(resolverOrigem({ etiquetas: ["Corte"] }).origem).toBe("desconhecido");
    });
});

describe("funil", () => {
    it("painel vazio: tudo zero, sem erro", () => {
        const f = consolidarFunil([]);
        expect(f.linhas).toHaveLength(7);
        expect(f.linhas.every((l) => l.contagem.total === 0)).toBe(true);
        expect(f.origemDesconhecida).toBe(0);
    });
    it("conta pessoas, não linhas, e mantém confirmado/inferido separados", () => {
        const f = consolidarFunil([ev("venda", "a", "inferido"), ev("venda", "a", "confirmado"), ev("venda", "b", "inferido"), ev("lead_recebido", "a", "confirmado")]);
        const venda = f.linhas.find((l) => l.tipo === "venda")!;
        expect(venda.contagem).toMatchObject({ confirmado: 1, inferido: 1, desconhecido: 0, total: 2 });
    });
    it("origem desconhecida é contada à parte e filtro por origem funciona", () => {
        const eventos = [ev("lead_recebido", "a", "confirmado", ANUN), ev("lead_recebido", "b", "confirmado"), ev("lead_recebido", "c", "confirmado")];
        const f = consolidarFunil(eventos);
        expect(f.origemDesconhecida).toBe(2);
        expect(f.linhas[0].porOrigem.anuncio.total).toBe(1);
        expect(f.linhas[0].porOrigem.desconhecido.total).toBe(2);
        const so = consolidarFunil(eventos, "anuncio");
        expect(so.linhas[0].contagem.total).toBe(1);
        expect(so.origemDesconhecida).toBe(0);
    });
});

describe("csv", () => {
    it("prefixa células que começam com = + - @ (injeção de fórmula)", () => {
        for (const p of ["=1+1", "+cmd", "-2", "@SUM(A1)"]) expect(celulaSegura(p)).toBe(`'${p}`);
        expect(celulaSegura("normal")).toBe("normal");
        expect(celulaSegura('a;"b')).toBe('"a;""b"');
    });
    it("CSV do funil tem cabeçalho, BOM e as colunas de confiança", () => {
        const csv = csvFunil(consolidarFunil([ev("lead_recebido", "a", "confirmado", ANUN)]));
        expect(csv.startsWith("﻿etapa;origem;confirmado;inferido;desconhecido")).toBe(true);
        expect(csv).toContain("Leads recebidos;Anúncio;1;0;0");
        expect(csv).toContain("Origem não identificada");
    });
});

describe("importação de agenda", () => {
    const AGORA = new Date("2026-11-13T12:00:00Z");
    const csv = [
        "tipo;contato;ocorrido_em;origem;campanha;referencia;valor",
        "agendamento_confirmado;(61) 99999-0001;2026-11-10;anuncio;Campanha Teste;AG-1;",
        "comparecimento;5561999990001;2026-11-11;;;AG-1;",
        "venda;5561999990001;2026-11-11;indicacao;;V-1;150,50",
    ].join("\n");
    it("aceita fixture sintética válida e normaliza contato, data e valor", () => {
        const r = interpretarImportacao("csv", csv, AGORA);
        expect(r.ok && r.resultado.eventos).toHaveLength(3);
        if (!r.ok) throw new Error();
        expect(r.resultado.eventos[0]).toMatchObject({ contactKey: "5561999990001@s.whatsapp.net", origem: "anuncio", dedupKey: "agendamento_confirmado:AG-1" });
        expect(r.resultado.eventos[2].valorCentavos).toBe(15050);
    });
    it("é idempotente: mesma entrada gera as mesmas chaves, e repetição no arquivo é descartada", () => {
        const a = interpretarImportacao("csv", csv, AGORA);
        const b = interpretarImportacao("csv", csv, AGORA);
        if (!a.ok || !b.ok) throw new Error();
        expect(a.resultado.eventos.map((e) => e.dedupKey)).toEqual(b.resultado.eventos.map((e) => e.dedupKey));
        const dup = interpretarImportacao("csv", csv + "\nvenda;5561999990001;2026-11-11;;;V-1;1", AGORA);
        if (!dup.ok) throw new Error();
        expect(dup.resultado.rejeitadas.at(-1)?.motivo).toMatch(/duplicada/);
    });
    it("sem referência a chave vem do hash de tipo+contato+data", () => {
        const r = interpretarImportacao("csv", "tipo;contato;ocorrido_em\nvenda;61999990002;2026-11-01", AGORA);
        if (!r.ok) throw new Error();
        expect(r.resultado.eventos[0].dedupKey).toMatch(/^h:[0-9a-f]{32}$/);
    });
    it("rejeita lixo linha a linha, com o número da linha", () => {
        const lixo = ["tipo;contato;ocorrido_em;origem;valor", "banana;5561999990001;2026-11-01;;", "venda;abc;2026-11-01;;", "venda;5561999990001;2026-02-31;;", "venda;5561999990001;2027-01-01;;", "venda;5561999990001;2026-11-01;marte;", "venda;5561999990001;2026-11-01;;-5", "venda;5561999990001;2026-11-01;;10"].join("\n");
        const r = interpretarImportacao("csv", lixo, AGORA);
        if (!r.ok) throw new Error();
        expect(r.resultado.eventos).toHaveLength(1);
        expect(r.resultado.rejeitadas.map((x) => x.linha)).toEqual([2, 3, 4, 5, 6, 7]);
    });
    it("rejeita arquivo inteiro sem cabeçalho obrigatório, JSON quebrado, vazio e grande demais", () => {
        expect(interpretarImportacao("csv", "a;b\n1;2", AGORA).ok).toBe(false);
        expect(interpretarImportacao("json", "{nao", AGORA).ok).toBe(false);
        expect(interpretarImportacao("json", "{}", AGORA).ok).toBe(false);
        expect(interpretarImportacao("json", "[]", AGORA).ok).toBe(false);
        expect(interpretarImportacao("csv", "x".repeat(1_000_001), AGORA).ok).toBe(false);
    });
    it("aceita JSON em lista ou em { eventos }", () => {
        const item = { tipo: "agendamento_solicitado", contato: "5561999990003", ocorrido_em: "2026-11-12T10:00:00-03:00", referencia: 42 };
        const a = interpretarImportacao("json", JSON.stringify([item]), AGORA);
        const b = interpretarImportacao("json", JSON.stringify({ eventos: [item, "lixo"] }), AGORA);
        expect(a.ok && a.resultado.eventos[0].dedupKey).toBe("agendamento_solicitado:42");
        expect(b.ok && b.resultado.rejeitadas).toHaveLength(1);
    });
    it("texto livre com controle e fórmula não quebra a leitura; fórmula é neutralizada só na exportação", () => {
        const r = interpretarImportacao("csv", 'tipo;contato;ocorrido_em;campanha\nvenda;5561999990001;2026-11-01;"=HYPERLINK(""x"")\nlinha2"', AGORA);
        if (!r.ok) throw new Error();
        expect(r.resultado.eventos[0].origemDetalhe).not.toMatch(/\n/);
        expect(celulaSegura(r.resultado.eventos[0].origemDetalhe)).toMatch(/^"?'=/);
    });
    it("normalizadores", () => {
        expect(normalizarContato("123")).toBeNull();
        expect(normalizarContato("5561999990001@s.whatsapp.net")).toBe("5561999990001@s.whatsapp.net");
        expect(lerData("2026-13-01")).toBeNull();
    });
});
