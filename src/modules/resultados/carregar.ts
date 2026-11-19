import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { resolverOrigem } from "./origem";
import type { EventoImportado } from "./agenda";
import type { Confianca, EventoResultado, Origem, TipoEvento } from "./tipos";
import { ORIGENS } from "./tipos";

/** Carregamento do painel de resultados. Tudo é filtrado pela sessão (e pelo userId dono dela): nenhuma consulta sem escopo. */

const LOTE = 500;
const NAO_CONTATO = [{ remoteJid: { endsWith: "@g.us" } }, { remoteJid: { endsWith: "@broadcast" } }, { remoteJid: { endsWith: "@newsletter" } }];

export interface SessaoAlvo { id: string; sessionId: string; userId: string }

export async function carregarEventos(sessao: SessaoAlvo, inicio: Date, fim: Date): Promise<{ eventos: EventoResultado[]; importadosSemConversa: number }> {
    const base = { sessionId: sessao.id, NOT: NAO_CONTATO };
    const noPeriodo = { gte: inicio, lte: fim };

    // Leads: primeira mensagem RECEBIDA registrada cai no período. shortcut: a retenção de mensagens pode apagar o histórico antigo e fazer um cliente antigo parecer lead (ver relatório).
    const leads = await prisma.message.groupBy({ by: ["remoteJid"], where: { ...base, fromMe: false }, _min: { timestamp: true }, having: { timestamp: { _min: noPeriodo } } });
    // Conversas iniciadas: qualquer mensagem recebida no período.
    const recebidas = await prisma.message.groupBy({ by: ["remoteJid"], where: { ...base, fromMe: false, timestamp: noPeriodo }, _min: { timestamp: true } });
    // Respostas: nossa mensagem POSTERIOR à primeira recebida no período. Continua heurística (não separa humano de automático): sai como inferida.
    // shortcut: os groupBy acima varrem Message do período por sessão; em volume alto exigem índice e EXPLAIN em staging (ver relatório).
    const enviadas = await prisma.message.groupBy({ by: ["remoteJid"], where: { ...base, fromMe: true, timestamp: noPeriodo }, _max: { timestamp: true } });
    const vendasIa = await prisma.vendaIA.findMany({ where: { sessionId: sessao.sessionId, criadoEm: noPeriodo }, select: { jid: true, criadoEm: true, valorCentavos: true } });
    const importados = await prisma.resultEvent.findMany({
        where: { userId: sessao.userId, sessionId: sessao.sessionId, ocorridoEm: noPeriodo },
        select: { contactKey: true, tipo: true, confianca: true, fonte: true, importacaoId: true, ocorridoEm: true, valorCentavos: true },
    });

    const contatos = [...new Set([...leads, ...recebidas, ...enviadas].map((m) => m.remoteJid).concat(vendasIa.map((v) => v.jid), importados.map((i) => i.contactKey)))];
    const conversaOrigem = new Map<string, "anuncio" | "organico">();
    const etiquetas = new Map<string, string[]>();
    const importadaPorContato = new Map<string, { origem: Origem; detalhe: string | null }>();
    const comConversa = new Set<string>();
    const importadosJids = new Set(importados.map((i) => i.contactKey));
    for (let i = 0; i < contatos.length; i += LOTE) {
        const lote = contatos.slice(i, i + LOTE);
        // as consultas do lote são independentes: rodam juntas (antes eram seriais)
        const [origens, marcas, declaradas, conversas] = await Promise.all([
            prisma.conversaOrigem.findMany({ where: { sessionId: sessao.sessionId, jid: { in: lote } }, select: { jid: true, origem: true } }),
            // Label.sessionId é a string do Baileys; ChatLabel só tem o jid, então o filtro de sessão passa pelo relacionamento
            prisma.chatLabel.findMany({ where: { chatJid: { in: lote }, label: { sessionId: sessao.sessionId } }, select: { chatJid: true, label: { select: { name: true } } } }),
            // origem declarada na planilha vale para o contato em qualquer período; determinística: a mais antiga (e id) vence
            prisma.resultEvent.findMany({ where: { userId: sessao.userId, sessionId: sessao.sessionId, contactKey: { in: lote }, origem: { not: null } }, orderBy: [{ ocorridoEm: "asc" }, { id: "asc" }], select: { contactKey: true, origem: true, origemDetalhe: true } }),
            prisma.message.groupBy({ by: ["remoteJid"], where: { sessionId: sessao.id, remoteJid: { in: lote.filter((j) => importadosJids.has(j)) } } }),
        ]);
        for (const c of conversas) comConversa.add(c.remoteJid);
        for (const d of declaradas) if (d.origem && (ORIGENS as readonly string[]).includes(d.origem) && !importadaPorContato.has(d.contactKey)) importadaPorContato.set(d.contactKey, { origem: d.origem as Origem, detalhe: d.origemDetalhe });
        for (const o of origens) conversaOrigem.set(o.jid, o.origem === "anuncio" ? "anuncio" : "organico");
        for (const m of marcas) etiquetas.set(m.chatJid, [...(etiquetas.get(m.chatJid) ?? []), m.label.name]);
    }

    const origemDe = (jid: string) => resolverOrigem({ conversaOrigem: conversaOrigem.get(jid), etiquetas: etiquetas.get(jid), importada: importadaPorContato.get(jid) });
    const eventos: EventoResultado[] = [];
    const add = (tipo: TipoEvento, contato: string, quando: Date, confianca: Confianca, fonte: string, extra: Partial<EventoResultado> = {}) =>
        eventos.push({ tipo, contato, quando, confianca, fonte, origem: origemDe(contato), ...extra });

    for (const l of leads) add("lead_recebido", l.remoteJid, l._min.timestamp!, "confirmado", "mensagem");
    for (const r of recebidas) add("conversa_iniciada", r.remoteJid, r._min.timestamp!, "confirmado", "mensagem");
    const primeiraRecebida = new Map(recebidas.map((r) => [r.remoteJid, r._min.timestamp!]));
    for (const e of enviadas) {
        const ini = primeiraRecebida.get(e.remoteJid);
        if (ini && e._max.timestamp! > ini) add("resposta", e.remoteJid, e._max.timestamp!, "inferido", "mensagem", { regra: "mensagem enviada depois da primeira recebida no período; não distingue resposta humana de automática" });
    }
    // A atendente IA registra a venda quando entende que fechou: não é conferida com caixa, então é inferida.
    for (const v of vendasIa) add("venda", v.jid, v.criadoEm, "inferido", "venda_ia", { regra: "venda registrada pela atendente IA, sem conferência com caixa ou agenda", valorCentavos: v.valorCentavos });
    for (const i of importados) {
        // Registros sem lote (gravados antes do campo importacaoId) foram marcados "confirmado" sem declaração de conferência: tratados como inferidos.
        const conf = (["confirmado", "inferido", "desconhecido"].includes(i.confianca) ? i.confianca : "desconhecido") as Confianca;
        const semLote = i.importacaoId === null && conf === "confirmado";
        add(i.tipo as TipoEvento, i.contactKey, i.ocorridoEm, semLote ? "inferido" : conf, i.fonte, { valorCentavos: i.valorCentavos, ...(semLote ? { regra: "importação antiga sem declaração de conferência" } : {}) });
    }
    return { eventos, importadosSemConversa: [...importadosJids].filter((j) => !comConversa.has(j)).length };
}

/** Grava os eventos importados. Idempotente: a chave única (userId, sessionId, dedupKey) faz o banco ignorar repetidos. */
export async function gravarImportacao(sessao: SessaoAlvo, eventos: EventoImportado[], fonte: "importacao_csv" | "importacao_json"): Promise<{ novos: number; repetidos: number; importacaoId: string | null }> {
    if (eventos.length === 0) return { novos: 0, repetidos: 0, importacaoId: null };
    const importacaoId = randomUUID();
    const r = await prisma.resultEvent.createMany({
        skipDuplicates: true,
        data: eventos.map((e) => ({
            userId: sessao.userId,
            sessionId: sessao.sessionId,
            contactKey: e.contactKey,
            tipo: e.tipo,
            origem: e.origem,
            origemDetalhe: e.origemDetalhe,
            // inferido por padrão: só "confirmado" se a linha declarou fonte_conferida
            confianca: e.confianca,
            importacaoId,
            fonte,
            refExterna: e.refExterna,
            dedupKey: e.dedupKey,
            valorCentavos: e.valorCentavos,
            ocorridoEm: e.ocorridoEm,
        })),
    });
    return { novos: r.count, repetidos: eventos.length - r.count, importacaoId: r.count > 0 ? importacaoId : null };
}
