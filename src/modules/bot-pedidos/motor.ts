import { logger as defaultLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { isOptedOut, isOptInText, isOptOutText } from "@/lib/optout";
import { MAX_TEXTO } from "@/modules/atendimento-comum/constantes";
import { diaSaoPaulo, mesSaoPaulo, prismaConsumo } from "@/modules/ia-atendimento/consumo";
import { LlmAnthropic, type Llm, type MensagemLlm } from "@/modules/ia-atendimento/llm";
import { isSaudacao } from "./afirmativo";
import type { EntradaBot } from "./entrada";
import { estadoPadrao, paraMensagensLlm, type EstadoBot } from "./estado";
import { executarFerramenta, FERRAMENTAS, limparNome, type ContextoFerramentas } from "./ferramentas";
import { chamarSaiae, type AcaoSaiae, type Cardapio, type RespostaSaiae } from "./saiae";

/**
 * Motor do bot de pedidos por WhatsApp. Só age se: SAIAE_INTEGRACAO_V1_URL está definida, a sessão pertence a uma
 * loja (entrada.ts), a sessão não tem o agente do salão nem regras de resposta automática (evita responder em
 * duplicidade) e o cardápio do Sai aê diz `bot_habilitado = true`. SAIR/VOLTAR ficam com o `bindOptOut`.
 * Nada de telefone, nome, itens ou texto nos logs.
 */

const TAG = "BotPedidos";
const MAX_PASSOS = 5;
export const FRANQUIA_PADRAO = 300;

export interface DepsMotor {
    env: Record<string, string | undefined>;
    now: () => number;
    logger: { info: (tag: string, msg: string) => void; warn: (tag: string, msg: string) => void };
    estado: EstadoBot;
    saiae: (acao: AcaoSaiae, barracaId: string, corpo?: Record<string, unknown>) => Promise<RespostaSaiae>;
    llm: () => Llm | null;
    /** Manda texto a um telefone (só dígitos) pela sessão. */
    enviar: (sessionId: string, telefone: string, texto: string) => Promise<boolean>;
    optado: (sessionId: string, jid: string) => Promise<boolean>;
    /** A sessão já tem o agente do salão ou respostas automáticas? Então o bot não entra. */
    sessaoOcupada: (sessionId: string) => Promise<boolean>;
    /** Conta uma conversa nova da loja no mês e devolve o total do mês. */
    contarConversa: (barracaId: string, agora: Date) => Promise<number>;
    registrarTokens: (barracaId: string, tokens: number, agora: Date) => Promise<void>;
}

let llmCompartilhado: Llm | null | undefined;
function llmPadrao(): Llm | null {
    if (llmCompartilhado !== undefined) return llmCompartilhado;
    const modelo = (process.env.IA_MODELO_BOT ?? process.env.IA_MODELO ?? "").trim();
    if (!modelo || !process.env.ANTHROPIC_API_KEY?.trim()) {
        defaultLogger.warn(TAG, "IA_MODELO (ou IA_MODELO_BOT) ou ANTHROPIC_API_KEY ausente: o bot só manda o link do cardápio");
        llmCompartilhado = null;
    } else {
        llmCompartilhado = new LlmAnthropic({ modelo });
    }
    return llmCompartilhado;
}

const depsPadrao = (): DepsMotor => ({
    env: process.env,
    now: Date.now,
    logger: defaultLogger,
    estado: estadoPadrao,
    saiae: (acao, barracaId, corpo) => chamarSaiae(acao, barracaId, corpo),
    llm: llmPadrao,
    enviar: async (sessionId, telefone, texto) => {
        const { getProvider } = await import("@/modules/whatsapp/provider"); // import tardio: evita ciclo com o manager
        const provider = getProvider(sessionId);
        if (!provider) return false;
        const para = await provider.resolveRecipient(`${telefone}@s.whatsapp.net`);
        await provider.sendText(para, texto);
        return true;
    },
    optado: (sessionId, jid) => isOptedOut(sessionId, jid),
    sessaoOcupada: async (sessionId) => {
        const agente = await prisma.agenteConfig.findUnique({ where: { sessionId }, select: { ativo: true } });
        if (agente?.ativo) return true;
        return (await prisma.autoReply.count({ where: { session: { sessionId } } })) > 0;
    },
    contarConversa: (barracaId, agora) => prismaConsumo.incrementar(`bot:${barracaId}`, mesSaoPaulo(agora)),
    // Reaproveita a tabela IaConsumo sem mudar o schema: o total de tokens do mês fica em `conversas` da chave "tokens:AAAA-MM".
    registrarTokens: async (barracaId, tokens, agora) => {
        if (tokens <= 0) return;
        await prisma.iaConsumo.upsert({
            where: { lojaCodigo_mes: { lojaCodigo: `bot:${barracaId}`, mes: `tokens:${mesSaoPaulo(agora)}` } },
            create: { lojaCodigo: `bot:${barracaId}`, mes: `tokens:${mesSaoPaulo(agora)}`, conversas: tokens },
            update: { conversas: { increment: tokens } },
        });
    },
});

export function franquiaDe(env: Record<string, string | undefined>): number {
    const n = Number.parseInt(env.BOT_FRANQUIA_CONVERSAS ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : FRANQUIA_PADRAO;
}

export function montarSistema(c: Cardapio): string {
    const pag = [c.loja.pagamentos.na_entrega ? "pagar na retirada" : null, c.loja.pagamentos.pix ? "Pix" : null].filter(Boolean).join(" e ") || "nenhuma";
    return [
        `Você atende clientes de "${c.loja.nome}" pelo WhatsApp e anota pedidos de RETIRADA. Responda em português, curto e simpático, no máximo 3 frases.`,
        "Regras:",
        "- Você NUNCA informa, calcula nem estima preço ou total. Valores só aparecem no resumo que o sistema envia depois de montar_rascunho.",
        "- Para anotar um pedido, use ver_cardapio para achar item_id e opcao_id e depois montar_rascunho. Item inexistente, esgotado ou opção inválida: diga que não achou e mande o link do cardápio.",
        "- Depois de montar_rascunho o sistema envia o resumo ao cliente. Não escreva mais nada sobre o pedido.",
        "- Só chame confirmar_pedido quando o cliente acabou de responder ao resumo com SIM ou PIX. Nunca confirme por conta própria.",
        "- Entrega não é anotada por aqui: mande o link do cardápio. Reclamação, pedido para falar com uma pessoa ou dúvida que você não sabe responder: use chamar_dono.",
        "- Use somente o link do cardápio informado abaixo e não invente informações da loja.",
        `Link do cardápio: ${c.loja.link_cardapio}`,
        `Formas de pagamento por aqui: ${pag}.`,
    ].join("\n");
}

/** Texto do modelo sem número de preço e só com o link real (o modelo nunca fala valor nem inventa link). */
export function filtrarTexto(texto: string | undefined, link: string): string {
    const limpo = (texto ?? "").trim();
    if (!limpo) return `Não consegui te ajudar por aqui. Veja o cardápio: ${link}`;
    if (/R\s*\$|\d[.,]\d|\b(reais|real|conto|contos|pila|pilas|centavos?)\b/i.test(limpo)) return `Os valores e o pedido ficam no cardápio: ${link}`;
    return limpo.replace(/https?:\/\/\S+/g, link).slice(0, 1000);
}

// Uma fila por sessão+contato: duas mensagens do mesmo cliente nunca são processadas ao mesmo tempo.
// shortcut: fila só em memória deste processo, como o resto do estado do bot.
const filas = new Map<string, Promise<void>>();

export function tratar(entrada: EntradaBot, over: Partial<DepsMotor> = {}): Promise<void> {
    const d: DepsMotor = { ...depsPadrao(), ...over };
    const chave = `${entrada.sessionId}:${entrada.contactKey}`;
    const rodar = async () => {
        try {
            await processar(entrada, d);
        } catch (e) {
            d.logger.warn(TAG, `falha no bot: ${(e as { name?: string })?.name ?? "erro"}`);
        }
    };
    const atual = (filas.get(chave) ?? Promise.resolve()).then(rodar);
    filas.set(chave, atual);
    return atual.finally(() => {
        if (filas.get(chave) === atual) filas.delete(chave);
    });
}

/** Uma pessoa escreveu pelo celular neste contato: o bot se cala por 12 h. */
export function humanoAssumiu(sessionId: string, contactKey: string, estado: EstadoBot = estadoPadrao): void {
    estado.pausar(sessionId, contactKey);
}

async function processar(e: EntradaBot, d: DepsMotor): Promise<void> {
    if (!d.env.SAIAE_INTEGRACAO_V1_URL?.trim()) return; // sem a URL o bot fica desligado
    const { sessionId, barracaId, contactKey } = e;
    if (d.estado.jaTratada(sessionId, e.messageId)) return;
    if (isOptOutText(e.texto) || isOptInText(e.texto)) return; // quem responde é o bindOptOut
    if (d.estado.pausada(sessionId, contactKey)) return;
    if (await d.optado(sessionId, `${contactKey}@s.whatsapp.net`)) return;
    if (await d.sessaoOcupada(sessionId)) return;
    if (d.estado.estourouLimite(sessionId, contactKey)) return;

    const r = await d.saiae("cardapio", barracaId);
    if (!r.ok || !("loja" in r)) return; // erro do Sai aê: sem dados da loja o bot não age
    const cardapio = r as unknown as Cardapio;
    const { loja } = cardapio;
    if (!loja.bot_habilitado) return; // loja que não ligou o bot continua só com os avisos

    const agora = new Date(d.now());
    let conv = d.estado.conversa(sessionId, contactKey);
    if (!conv) {
        conv = { historico: [], rascunho: null, aguardandoConfirmacao: false, hashMostrado: null, soLink: false };
        try {
            conv.soLink = (await d.contarConversa(barracaId, agora)) > franquiaDe(d.env);
        } catch {
            d.logger.warn(TAG, "contagem de conversas falhou");
        }
    }
    const aguardava = conv.aguardandoConfirmacao;
    conv.aguardandoConfirmacao = false;
    const texto = e.texto.slice(0, MAX_TEXTO);
    const dia = diaSaoPaulo(agora);

    /** Devolve true se TODAS as mensagens foram entregues ao provedor. */
    const responder = async (mensagens: string[]): Promise<boolean> => {
        let ok = true;
        for (const m of mensagens) {
            try {
                if (!(await d.enviar(sessionId, contactKey, m))) {
                    ok = false;
                    d.logger.warn(TAG, "sessão indisponível para envio");
                }
            } catch (err) {
                ok = false;
                d.logger.warn(TAG, `envio falhou: ${(err as { name?: string })?.name ?? "erro"}`);
                break;
            }
        }
        conv.historico.push({ papel: "user", texto }, { papel: "assistant", texto: mensagens.join("\n").slice(0, 1500) });
        d.estado.salvarConversa(sessionId, contactKey, conv);
        return ok;
    };

    const llm = d.llm();
    const link = loja.link_cardapio;
    if (isSaudacao(texto) || conv.soLink || !loja.aberta_agora || !llm) {
        if (!isSaudacao(texto) && !d.estado.primeiroLinkDoDia(sessionId, contactKey, dia)) {
            d.estado.salvarConversa(sessionId, contactKey, conv);
            return; // só-link repetido no mesmo dia: não insiste
        }
        await responder([saudacao(cardapio, conv.soLink || !llm)]);
        return;
    }

    const ctx: ContextoFerramentas = {
        sessionId, contactKey, barracaId, nome: e.nome === null ? null : limparNome(e.nome, ""), textoAtual: texto, aguardava, cardapio, conversa: conv, agora: d.now(),
        saiae: (acao, corpo) => d.saiae(acao, barracaId, corpo),
        avisarDono: async (aviso) => {
            const dono = loja.whatsapp_dono?.replace(/\D/g, "");
            if (!dono) return false;
            try {
                return await d.enviar(sessionId, dono, aviso);
            } catch {
                return false;
            }
        },
        pausar: () => d.estado.pausar(sessionId, contactKey),
        respostas: [],
        resumoEnviado: false,
        retentar: false,
    };

    const mensagens: MensagemLlm[] = [...paraMensagensLlm(conv), { papel: "user", texto }];
    let final: string | undefined;
    let tokens = 0;
    try {
        for (let passo = 0; passo < MAX_PASSOS; passo++) {
            const saida = await llm.responder({ sistema: montarSistema(cardapio), mensagens, ferramentas: FERRAMENTAS });
            tokens += (saida.uso?.entrada ?? 0) + (saida.uso?.saida ?? 0);
            if (saida.chamadas.length === 0) {
                final = saida.texto;
                break;
            }
            mensagens.push({ papel: "assistant", texto: saida.texto, chamadas: saida.chamadas });
            const resultados = [];
            for (const c of saida.chamadas) {
                const res = await executarFerramenta(c.nome, c.argumentos, ctx);
                resultados.push({ id: c.id, texto: res.texto, ...(res.erro ? { erro: true } : {}) });
            }
            mensagens.push({ papel: "tool", resultados });
            if (ctx.respostas.length) break; // o código já montou a resposta (resumo, pedido, Pix, aviso ao dono)
        }
    } catch (err) {
        d.logger.warn(TAG, `modelo falhou: ${(err as { name?: string })?.name ?? "erro"}`);
    }
    await d.registrarTokens(barracaId, tokens, agora).catch(() => d.logger.warn(TAG, "registro de tokens falhou"));

    // Quando o código montou respostas (resumo, pedido, Pix), só elas saem; o texto do modelo só vai filtrado.
    const enviou = await responder(ctx.respostas.length ? ctx.respostas : [filtrarTexto(final, link)]);
    // O "sim" só vale se o cliente de fato recebeu o resumo (ou se a confirmação falhou de forma retentável).
    const rasc = conv.rascunho;
    conv.hashMostrado = rasc && enviou && ctx.resumoEnviado ? rasc.hash : rasc && ctx.retentar ? conv.hashMostrado : null;
    conv.aguardandoConfirmacao = enviou && !!rasc && (ctx.resumoEnviado || ctx.retentar);
}

function saudacao(c: Cardapio, soLink: boolean): string {
    const { loja } = c;
    if (!loja.aberta_agora) return `Oi! O ${loja.nome} está fechado agora. Veja o cardápio: ${loja.link_cardapio}`;
    if (soLink) return `Oi! Faça seu pedido pelo cardápio do ${loja.nome}: ${loja.link_cardapio}`;
    return `Oi! Aqui é o ${loja.nome}. Veja o cardápio e faça seu pedido: ${loja.link_cardapio}\nSe preferir, é só me dizer o que quer pedir que eu anoto por aqui.`;
}

