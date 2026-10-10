import type { WASocket, WAMessage } from "@whiskeysockets/baileys";
import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { canonicalPhone, formatPhoneBr } from "@/lib/phone";
import { isOptedOut, isOptInText, isOptOutText } from "@/lib/optout";
import { LlmAnthropic, type Llm } from "@/modules/ia-atendimento/llm";
import { MAX_TEXTO } from "@/modules/ia-atendimento/constantes";
import { CONHECIMENTO_LAVINIA_PADRAO } from "./conhecimento-lavinia";
import { foiEnviadaPeloCrm } from "./enviados";
import { ehComandoDevolver, iaPausada, pessoaAssumiu, primeiroNome, salaoAberto } from "./estado";
import { MSG_AUDIO, MSG_SO_TEXTO, responderSalao, type EtiquetaInteresse, type MotivoRecepcao, type PedidoRecepcao } from "./motor";

/**
 * Liga o agente do salão ao socket do WhatsApp (QR/Baileys) de UMA sessão.
 * - Só responde a quem escreveu (evento de mensagem recebida); nunca puxa conversa.
 * - Espera alguns segundos para juntar mensagens seguidas e responde uma vez.
 * - Quando uma pessoa escreve pelo celular/WhatsApp Web (mensagem "fromMe" que não saiu do CRM), cala por `pausaHoras`.
 * - "#lavinia" digitado na conversa devolve a IA na hora.
 */

const TAG = "AgenteSalao";
const DEBOUNCE_MS = 7000;
const IDADE_MAX_MS = 15 * 60_000; // mensagem recebida há mais que isso (servidor ficou fora) não é respondida
const MAX_RESPOSTAS_HORA = 10; // por contato: trava contra conversa entre dois robôs
const CACHE_CONFIG_MS = 20_000;

export interface ConfigAgente {
    sessionId: string;
    ativo: boolean;
    nome: string;
    conhecimento: string;
    promocoes: string | null;
    linkAgendamento: string | null;
    grupoRecepcaoJid: string | null;
    numerosIgnorados: string[];
    followUpHoras: number;
    pausaHoras: number;
    diasAbertos: string;
    horaAbre: number;
    horaFecha: number;
}

const cache = new Map<string, { em: number; cfg: ConfigAgente | null }>();

export function limparCacheConfigAgente(sessionId?: string): void {
    if (sessionId) cache.delete(sessionId);
    else cache.clear();
}

export async function carregarConfigAgente(sessionId: string): Promise<ConfigAgente | null> {
    const hit = cache.get(sessionId);
    if (hit && Date.now() - hit.em < CACHE_CONFIG_MS) return hit.cfg;
    const r = await prisma.agenteConfig.findUnique({ where: { sessionId } });
    const cfg: ConfigAgente | null = r
        ? {
              sessionId,
              ativo: r.ativo,
              nome: r.nome,
              conhecimento: r.conhecimento?.trim() || CONHECIMENTO_LAVINIA_PADRAO,
              promocoes: r.promocoes,
              linkAgendamento: r.linkAgendamento,
              grupoRecepcaoJid: r.grupoRecepcaoJid,
              numerosIgnorados: Array.isArray(r.numerosIgnorados) ? (r.numerosIgnorados as unknown[]).map(String) : [],
              followUpHoras: r.followUpHoras,
              pausaHoras: r.pausaHoras,
              diasAbertos: r.diasAbertos,
              horaAbre: r.horaAbre,
              horaFecha: r.horaFecha,
          }
        : null;
    cache.set(sessionId, { em: Date.now(), cfg });
    return cfg;
}

// ------------------------------------------------------------------ mensagem recebida

interface ConteudoMensagem {
    texto: string;
    audio: boolean;
    naoTexto: boolean;
    ignorar: boolean;
}

export function lerConteudo(msg: WAMessage): ConteudoMensagem {
    const c: any = normalizeMessageContent(msg.message);
    if (!c) return { texto: "", audio: false, naoTexto: false, ignorar: true };
    if (c.protocolMessage || c.reactionMessage || c.pollUpdateMessage || c.senderKeyDistributionMessage || c.editedMessage) return { texto: "", audio: false, naoTexto: false, ignorar: true };
    const texto: string = c.conversation || c.extendedTextMessage?.text || c.imageMessage?.caption || c.videoMessage?.caption || c.documentMessage?.caption || "";
    if (c.audioMessage) return { texto: "", audio: true, naoTexto: false, ignorar: false };
    if (texto) return { texto: texto.slice(0, MAX_TEXTO), audio: false, naoTexto: false, ignorar: false };
    return { texto: "", audio: false, naoTexto: true, ignorar: false };
}

/** Mensagem que veio de um anúncio de "clique para WhatsApp" do Meta. */
export function veioDeAnuncioMeta(msg: WAMessage): boolean {
    const c: any = normalizeMessageContent(msg.message);
    const ctx = c?.extendedTextMessage?.contextInfo ?? c?.imageMessage?.contextInfo ?? c?.videoMessage?.contextInfo;
    return !!(ctx?.externalAdReply || ctx?.conversionSource);
}

const telefoneDe = (jid: string, alt?: string | null): string | null => {
    const j = jid.endsWith("@s.whatsapp.net") ? jid : alt && alt.endsWith("@s.whatsapp.net") ? alt : null;
    return j ? j.split("@")[0].split(":")[0].replace(/\D/g, "") || null : null;
};

// ------------------------------------------------------------------ estado no banco

async function garantirConversa(sessionId: string, jid: string, extra: { telefone?: string | null; nomePerfil?: string | null } = {}) {
    return prisma.agenteConversa.upsert({
        where: { sessionId_jid: { sessionId, jid } },
        create: { sessionId, jid, telefone: extra.telefone ?? null, nomePerfil: extra.nomePerfil ?? null },
        update: { ...(extra.telefone ? { telefone: extra.telefone } : {}), ...(extra.nomePerfil ? { nomePerfil: extra.nomePerfil } : {}) },
    });
}

// ------------------------------------------------------------------ etiquetas e aviso à recepção

async function aplicarEtiqueta(sock: WASocket, sessionId: string, chatJid: string, nome: string): Promise<boolean> {
    try {
        const label = await prisma.label.findFirst({ where: { sessionId, name: nome } });
        if (!label) {
            logger.warn(TAG, `etiqueta "${nome}" não existe nesta sessão (sincronize as etiquetas)`);
            return false;
        }
        const waId = label.id.startsWith(`${sessionId}:`) ? label.id.slice(sessionId.length + 1) : label.id;
        await sock.addChatLabel(chatJid, waId);
        await prisma.chatLabel.upsert({ where: { labelId_chatJid: { labelId: label.id, chatJid } }, update: {}, create: { labelId: label.id, chatJid } });
        return true;
    } catch (e) {
        logger.warn(TAG, `não consegui etiquetar: ${(e as { name?: string })?.name ?? "erro"}`);
        return false;
    }
}

const TEXTO_MOTIVO: Record<MotivoRecepcao, string> = {
    audio: "áudio",
    agendamento: "agendamento",
    maquiagem_penteado: "maquiagem/penteado",
    clube_tati: "Clube Tati",
    reclamacao: "reclamação",
    desconto: "desconto/condição especial",
    duvida: "dúvida",
    pediu_humano: "pediu humano",
    saude: "questão de saúde",
};

export function montarAvisoRecepcao(p: PedidoRecepcao & { telefone: string | null; nomePerfil: string | null }): string {
    const nome = p.nome || primeiroNome(p.nomePerfil) || "(sem nome)";
    return [
        "Cliente aguardando resposta - bot",
        `Nome: ${nome}`,
        `Telefone: ${p.telefone ? formatPhoneBr(p.telefone) : "número oculto (responda pela conversa no WhatsApp)"}`,
        `Motivo: ${TEXTO_MOTIVO[p.motivo]}`,
        `Serviço: ${p.servico || "-"}`,
        `Dia/horário desejado: ${p.diaHorario || "-"}`,
        `Resumo: ${p.resumo || "-"}`,
    ].join("\n");
}

// ------------------------------------------------------------------ o agente

interface Pendente {
    textos: string[];
    audio: boolean;
    naoTexto: boolean;
    msg: WAMessage;
    timer: ReturnType<typeof setTimeout> | null;
    processando: boolean;
}

const estaLigado = new WeakSet<object>();
let llmCompartilhado: Llm | null | undefined;

function obterLlm(): Llm | null {
    if (llmCompartilhado !== undefined) return llmCompartilhado;
    const modelo = (process.env.IA_MODELO_SALAO ?? process.env.IA_MODELO ?? "").trim();
    if (!modelo || !process.env.ANTHROPIC_API_KEY?.trim()) {
        logger.warn(TAG, "IA_MODELO (ou IA_MODELO_SALAO) ou ANTHROPIC_API_KEY ausente: o agente do salão não vai responder");
        llmCompartilhado = null;
    } else {
        llmCompartilhado = new LlmAnthropic({ modelo });
    }
    return llmCompartilhado;
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface OpcoesAgente {
    /** Só para testes: modelo falso. */
    llm?: Llm;
    debounceMs?: number;
    /** Só para testes: sem "digitando..." nem pausas entre mensagens. */
    rapido?: boolean;
}

export function bindAgenteSalao(sock: WASocket, sessionId: string, over: OpcoesAgente = {}): void {
    if (process.env.AGENTE_SALAO?.trim().toLowerCase() === "off") return;
    if (estaLigado.has(sock)) return;
    estaLigado.add(sock);

    const pendentes = new Map<string, Pendente>();
    const respostasHora = new Map<string, number[]>();
    let dbSessionId: string | null = null;

    const idDaSessao = async () => {
        if (!dbSessionId) dbSessionId = (await prisma.session.findUnique({ where: { sessionId }, select: { id: true } }))?.id ?? null;
        return dbSessionId;
    };

    const passouLimiteHora = (jid: string): boolean => {
        const agora = Date.now();
        const lista = (respostasHora.get(jid) ?? []).filter((t) => agora - t < 3_600_000);
        respostasHora.set(jid, lista);
        return lista.length >= MAX_RESPOSTAS_HORA;
    };

    const enviar = async (jid: string, texto: string) => {
        if (over.rapido) {
            await sock.sendMessage(jid, { text: texto });
            return;
        }
        try {
            await sock.sendPresenceUpdate("composing", jid);
            await dormir(Math.min(6000, 1200 + texto.length * 25));
            await sock.sendPresenceUpdate("paused", jid);
        } catch { /* presença é só efeito visual */ }
        await sock.sendMessage(jid, { text: texto });
    };

    const processar = async (jid: string, p: Pendente) => {
        const cfg = await carregarConfigAgente(sessionId);
        if (!cfg?.ativo) return;
        const llm = over.llm ?? obterLlm();
        if (!llm) return;
        const agora = new Date();
        const msg = p.msg;
        const telefone = telefoneDe(jid, (msg.key as any).remoteJidAlt);
        const nomePerfil = msg.pushName ?? null;

        let conv = await garantirConversa(sessionId, jid, { telefone, nomePerfil });
        if (iaPausada(conv, agora)) return; // uma pessoa assumiu ou a recepção foi chamada
        if (conv.estado === "humano") conv = await prisma.agenteConversa.update({ where: { id: conv.id }, data: { estado: "ia", pausadaAte: null, motivoPausa: null } });
        if (passouLimiteHora(jid)) {
            logger.warn(TAG, "limite de respostas por hora neste contato: ignorando");
            return;
        }

        const chamarRecepcao = async (pedido: PedidoRecepcao): Promise<boolean> => {
            if (!cfg.grupoRecepcaoJid) {
                logger.warn(TAG, "grupo da recepção não configurado: não foi possível avisar");
                return false;
            }
            try {
                await sock.sendMessage(cfg.grupoRecepcaoJid, { text: montarAvisoRecepcao({ ...pedido, telefone, nomePerfil }) });
            } catch (e) {
                logger.warn(TAG, `aviso à recepção falhou: ${(e as { name?: string })?.name ?? "erro"}`);
                return false;
            }
            await prisma.agenteConversa.update({
                where: { id: conv.id },
                data: { estado: "humano", pausadaAte: new Date(Date.now() + cfg.pausaHoras * 3_600_000), motivoPausa: pedido.motivo, ...(pedido.servico ? { servico: pedido.servico } : {}) },
            });
            await aplicarEtiqueta(sock, sessionId, jid, "Aguardando resposta");
            return true;
        };

        let mensagens: string[];
        let chamou = false;
        if (p.audio) {
            chamou = await chamarRecepcao({ motivo: "audio", resumo: "A cliente mandou um áudio" });
            mensagens = [MSG_AUDIO];
        } else if (p.textos.length === 0) {
            mensagens = [MSG_SO_TEXTO];
        } else {
            const dbId = await idDaSessao();
            const hist = dbId
                ? await prisma.message.findMany({ where: { sessionId: dbId, remoteJid: jid, content: { not: null } }, orderBy: { timestamp: "desc" }, take: 14, select: { fromMe: true, content: true } })
                : [];
            const ordem = hist.reverse();
            // mensagens recebidas depois da última resposta fazem parte do lote atual (já vêm de `p.textos`)
            while (ordem.length && !ordem[ordem.length - 1].fromMe) ordem.pop();
            const historico = ordem.map((m) => ({ direcao: (m.fromMe ? "out" : "in") as "in" | "out", texto: m.content ?? "" }));

            const r = await responderSalao(
                { llm, historico, logger },
                {
                    conhecimento: cfg.conhecimento,
                    promocoes: cfg.promocoes,
                    nomePerfil,
                    salaoAberto: salaoAberto(cfg, agora),
                    agora,
                    textoCliente: p.textos.join("\n").slice(0, MAX_TEXTO * 2),
                    acoes: {
                        linkAgendamento: cfg.linkAgendamento,
                        chamarRecepcao,
                        etiquetar: (e: EtiquetaInteresse) => aplicarEtiqueta(sock, sessionId, jid, e),
                    },
                }
            );
            mensagens = r.mensagens;
            chamou = r.chamouRecepcao;
        }

        // uma pessoa pode ter assumido enquanto a IA pensava: nesse caso não manda nada (exceto o aviso de transferência)
        if (!chamou) {
            const atual = await prisma.agenteConversa.findUnique({ where: { id: conv.id } });
            if (atual && iaPausada(atual, new Date())) return;
        }

        const lista = respostasHora.get(jid) ?? [];
        lista.push(Date.now());
        respostasHora.set(jid, lista);

        for (const [i, texto] of mensagens.entries()) {
            if (i > 0 && !over.rapido) await dormir(1500 + Math.floor(Math.random() * 1500));
            await enviar(jid, texto);
        }
        await prisma.agenteConversa.update({
            where: { id: conv.id },
            data: { ultimaIaAt: new Date(), ultimaIaPerguntou: mensagens[mensagens.length - 1].includes("?") && !chamou },
        });
    };

    const agendar = (jid: string, p: Pendente) => {
        if (p.timer) clearTimeout(p.timer);
        p.timer = setTimeout(async () => {
            if (p.processando) return agendar(jid, p);
            p.processando = true;
            pendentes.delete(jid);
            try {
                await processar(jid, p);
            } catch (e) {
                logger.warn(TAG, `falha ao responder: ${(e as { name?: string })?.name ?? "erro"}`);
            }
        }, over.debounceMs ?? DEBOUNCE_MS);
    };

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        for (const msg of messages) {
            try {
                const jid = msg.key.remoteJid;
                if (!jid || !msg.message) continue;
                if (!(jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"))) continue; // grupos, status, listas e canais ficam de fora
                const c = lerConteudo(msg);
                if (c.ignorar) continue;
                const criadaEm = new Date(Number(msg.messageTimestamp ?? 0) * 1000 || Date.now());

                // ---- mensagem que saiu do número
                if (msg.key.fromMe) {
                    const cfg = await carregarConfigAgente(sessionId);
                    if (!cfg?.ativo) continue;
                    if (c.texto && ehComandoDevolver(c.texto) && !foiEnviadaPeloCrm(msg.key.id)) {
                        await prisma.agenteConversa.upsert({
                            where: { sessionId_jid: { sessionId, jid } },
                            create: { sessionId, jid },
                            update: { estado: "ia", pausadaAte: null, motivoPausa: null },
                        });
                        continue;
                    }
                    if (pessoaAssumiu({ fromMe: true, enviadaPeloCrm: foiEnviadaPeloCrm(msg.key.id), criadaEm, agora: new Date(), tipoEvento: type })) {
                        const ate = new Date(Date.now() + cfg.pausaHoras * 3_600_000);
                        await prisma.agenteConversa.upsert({
                            where: { sessionId_jid: { sessionId, jid } },
                            create: { sessionId, jid, estado: "humano", pausadaAte: ate, motivoPausa: "pessoa_assumiu", ultimaHumanoAt: new Date() },
                            update: { estado: "humano", pausadaAte: ate, motivoPausa: "pessoa_assumiu", ultimaHumanoAt: new Date() },
                        });
                        const p = pendentes.get(jid);
                        if (p?.timer) clearTimeout(p.timer);
                        pendentes.delete(jid);
                    }
                    continue;
                }

                // ---- mensagem recebida
                if (type !== "notify") continue;
                if (Date.now() - criadaEm.getTime() > IDADE_MAX_MS) continue;
                const cfg = await carregarConfigAgente(sessionId);
                if (!cfg?.ativo) continue;

                const telefone = telefoneDe(jid, (msg.key as any).remoteJidAlt);
                if (telefone && cfg.numerosIgnorados.some((n) => canonicalPhone(n) === canonicalPhone(telefone))) continue;
                if (c.texto && (isOptOutText(c.texto) || isOptInText(c.texto))) continue; // o descadastro responde por conta própria
                if (telefone && (await isOptedOut(sessionId, `${telefone}@s.whatsapp.net`))) continue;

                const primeira = !(await prisma.agenteConversa.findUnique({ where: { sessionId_jid: { sessionId, jid } }, select: { id: true } }));
                await garantirConversa(sessionId, jid, { telefone, nomePerfil: msg.pushName ?? null });
                await prisma.agenteConversa.update({ where: { sessionId_jid: { sessionId, jid } }, data: { ultimaInboundAt: new Date(), followUpEm: null } });
                if (primeira && veioDeAnuncioMeta(msg)) await aplicarEtiqueta(sock, sessionId, jid, "Vindo de anúncio do Meta");

                const p = pendentes.get(jid) ?? { textos: [], audio: false, naoTexto: false, msg, timer: null, processando: false };
                if (c.texto) p.textos.push(c.texto);
                if (c.audio) p.audio = true;
                if (c.naoTexto) p.naoTexto = true;
                p.msg = msg;
                pendentes.set(jid, p);
                agendar(jid, p);
            } catch (e) {
                logger.warn(TAG, `falha ao tratar mensagem: ${(e as { name?: string })?.name ?? "erro"}`);
            }
        }
    });

    logger.info(TAG, `agente do salão ligado ao socket da sessão (responde só a quem escreve)`);
}

// ------------------------------------------------------------------ envio do follow-up (usado pelo agendador)

export async function aplicarEtiquetaNaSessao(sock: WASocket, sessionId: string, chatJid: string, nome: string): Promise<boolean> {
    return aplicarEtiqueta(sock, sessionId, chatJid, nome);
}
