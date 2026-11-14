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
        expect(f.linhas[0].porOrigem.find((o) => o.origem === "anuncio")?.contagem.total).toBe(1);
        expect(f.linhas[0].porOrigem.find((o) => o.origem === "desconhecido")?.contagem.total).toBe(2);
        const so = consolidarFunil(eventos, "anuncio");
        expect(so.linhas[0].contagem.total).toBe(1);
        expect(so.origemDesconhecida).toBe(0);
    });
});

describe("confiança da origem (B1)", () => {
    const ORG: OrigemResolvida = { origem: "organico", confianca: "inferido", regra: "sem marcador" };
    it("lead orgânico (origem inferida) nunca aparece com origem confirmada, mesmo com evento confirmado", () => {
        const f = consolidarFunil([ev("lead_recebido", "a", "confirmado", ORG), ev("lead_recebido", "b", "confirmado", ANUN)]);
        const lin = f.linhas[0].porOrigem;
        expect(lin.find((o) => o.origem === "organico")).toMatchObject({ confiancaOrigem: "inferido" });
        expect(lin.filter((o) => o.confiancaOrigem === "confirmado").map((o) => o.origem)).toEqual(["anuncio"]);
        const csv = csvFunil(f);
        expect(csv).toContain("Leads recebidos;Orgânico;origem inferida;1;0;0");
        expect(csv).toContain("Leads recebidos;Anúncio;origem confirmada;1;0;0");
        expect(csv).not.toContain("Orgânico;origem confirmada");
    });
    it("mesma origem com confianças diferentes fica em linhas separadas", () => {
        const f = consolidarFunil([ev("lead_recebido", "a", "confirmado", ANUN), ev("lead_recebido", "b", "confirmado", { ...ANUN, confianca: "inferido" })]);
        expect(f.linhas[0].porOrigem).toHaveLength(2);
    });
});

describe("origem por etiqueta: palavra inteira e conflito", () => {
    it("meta só como palavra inteira", () => {
        expect(origemDaEtiqueta("Meta")).toBe("anuncio");
        expect(origemDaEtiqueta("Metade do pacote")).toBeNull();
        expect(origemDaEtiqueta("Metas de abril")).toBeNull();
    });
    it("etiquetas de origem em conflito resultam em desconhecida; iguais não conflitam", () => {
        expect(resolverOrigem({ etiquetas: ["Meta", "Indicação"] })).toMatchObject({ origem: "desconhecido", confianca: "desconhecido" });
        expect(resolverOrigem({ etiquetas: ["Meta", "Facebook"] })).toMatchObject({ origem: "anuncio", confianca: "inferido" });
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
        expect(csv.startsWith("﻿etapa;origem;confianca_da_origem;confirmado;inferido;desconhecido")).toBe(true);
        expect(csv).toContain("Leads recebidos;Anúncio;origem confirmada;1;0;0");
        expect(csvFunil(consolidarFunil([ev("lead_recebido", "b", "confirmado")]))).toContain("Origem não identificada;origem não identificada");
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
        expect(r.resultado.eventos[0]).toMatchObject({ contactKey: "5561999990001@s.whatsapp.net", origem: "anuncio", dedupKey: expect.stringMatching(/^r:[0-9a-f]{64}$/), confianca: "inferido" });
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
    const L = (...l: string[]) => l.join("\n");
    it("confirmado só com fonte_conferida explícita e válida; padrão é inferido", () => {
        const r = interpretarImportacao("csv", L("tipo;contato;ocorrido_em;referencia;fonte_conferida", "venda;61999990001;2026-11-01;A;sim", "venda;61999990001;2026-11-02;B;", "venda;61999990001;2026-11-03;C;talvez"), AGORA);
        if (!r.ok) throw new Error();
        expect(r.resultado.eventos.map((e) => e.confianca)).toEqual(["confirmado", "inferido"]);
        expect(r.resultado.rejeitadas[0].motivo).toMatch(/fonte_conferida/);
    });
    it("mesma referência em contatos diferentes não colide", () => {
        const r = interpretarImportacao("csv", L("tipo;contato;ocorrido_em;referencia", "venda;61999990001;2026-11-01;X", "venda;61999990002;2026-11-01;X"), AGORA);
        expect(r.ok && r.resultado.eventos).toHaveLength(2);
    });
    it("vendas no mesmo dia sem referência: não junta em silêncio, avisa com contagem", () => {
        const r = interpretarImportacao("csv", L("tipo;contato;ocorrido_em", "venda;61999990001;2026-11-01", "venda;61999990001;2026-11-01", "venda;61999990001;2026-11-01"), AGORA);
        if (!r.ok) throw new Error();
        expect(r.resultado.eventos).toHaveLength(1);
        expect(r.resultado.repetidasNoArquivo).toBe(2);
        expect(r.resultado.repetidasSemReferencia).toBe(2);
        expect(r.resultado.avisos.join(" ")).toMatch(/2 linha\(s\) sem "referencia"/);
    });
    it("valor ambíguo 1.234 é rejeitado; 1.234,50 e 1234.5 passam", () => {
        const r = interpretarImportacao("csv", L("tipo;contato;ocorrido_em;referencia;valor", "venda;61999990001;2026-11-01;A;1.234", "venda;61999990001;2026-11-02;B;1.234,50", "venda;61999990001;2026-11-03;C;1234.5"), AGORA);
        if (!r.ok) throw new Error();
        expect(r.resultado.rejeitadas[0].motivo).toMatch(/ambíguo/);
        expect(r.resultado.eventos.map((e) => e.valorCentavos)).toEqual([123450, 123450]);
    });
    it("avisa de aspa solta e de encoding inválido", () => {
        const a = interpretarImportacao("csv", L("tipo;contato;ocorrido_em;campanha", 'venda;61999990001;2026-11-01;"abre sem fechar'), AGORA);
        expect(a.ok && a.resultado.avisos.join(" ")).toMatch(/aspas abertas/);
        const b = interpretarImportacao("csv", L("tipo;contato;ocorrido_em;campanha", "venda;61999990001;2026-11-01;Corte �"), AGORA);
        expect(b.ok && b.resultado.avisos.join(" ")).toMatch(/UTF-8/);
    });
    it("referências que diferem só por caixa geram chaves diferentes e ambas são importadas (a collation do banco ignora caixa)", () => {
        const r = interpretarImportacao("csv", L("tipo;contato;ocorrido_em;referencia", "venda;61999990001;2026-11-01;PedidoA", "venda;61999990001;2026-11-01;pedidoa"), AGORA);
        if (!r.ok) throw new Error();
        expect(r.resultado.eventos).toHaveLength(2);
        const [a, b] = r.resultado.eventos.map((e) => e.dedupKey);
        expect(a).not.toBe(b);
        expect(a.toLowerCase()).not.toBe(b.toLowerCase()); // distintas até comparando sem diferenciar caixa
        expect(a.length).toBeLessThanOrEqual(191);
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
        expect(a.ok && a.resultado.eventos[0].dedupKey).toMatch(/^r:[0-9a-f]{64}$/);
        expect(b.ok && b.resultado.rejeitadas).toHaveLength(1);
    });
    it("texto livre com controle e fórmula não quebra a leitura; fórmula é neutralizada só na exportação", () => {
        const r = interpretarImportacao("csv", 'tipo;contato;ocorrido_em;campanha\nvenda;5561999990001;2026-11-01;"=HYPERLINK(""x"")\nlinha2"', AGORA);
        if (!r.ok) throw new Error();
        expect(r.resultado.eventos[0].origemDetalhe).not.toMatch(/\n/);
        expect(celulaSegura(r.resultado.eventos[0].origemDetalhe)).toMatch(/^"?'=/);
    });
    it("ISO completo com data de calendário inexistente é recusado (sem normalizar para outro dia)", () => {
        for (const t of [
            "2026-02-31T12:00:00-03:00", "2026-02-30T12:00:00Z", "2026-04-31T08:00:00-03:00", "2025-02-29T12:00:00-03:00",
            "2026-11-10T24:00:00-03:00", "2026-13-10T12:00:00-03:00", "2026-11-10T12:60:00Z", "2026-11-10T12:00:60Z", "2026-11-10T12:00:00+24:00", "2026-00-10T12:00:00Z", "2026-11-00T12:00:00Z",
        ]) expect(lerData(t), t).toBeNull();
        expect(lerData("2028-02-29T12:00:00-03:00")).toBeInstanceOf(Date); // bissexto
        expect(lerData("2026-11-10T23:59:59.500+05:30")).toBeInstanceOf(Date);
        const r = interpretarImportacao("csv", "tipo;contato;ocorrido_em;fonte_conferida\nvenda;61999990001;2026-02-31T12:00:00-03:00;sim", AGORA);
        if (!r.ok) throw new Error();
        expect(r.resultado.eventos).toHaveLength(0);
        expect(r.resultado.rejeitadas).toEqual([{ linha: 2, motivo: expect.stringMatching(/data inválida/) }]);
    });
    it("normalizadores", () => {
        expect(normalizarContato("123")).toBeNull();
        expect(normalizarContato("5561999990001@s.whatsapp.net")).toBe("5561999990001@s.whatsapp.net");
        expect(lerData("2026-13-01")).toBeNull();
    });
});
