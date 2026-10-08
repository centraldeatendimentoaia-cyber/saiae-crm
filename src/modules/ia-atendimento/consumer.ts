import crypto from "crypto";
import { logger as defaultLogger } from "@/lib/logger";
import { addOptOut, isOptedOut, isOptInText, isOptOutText, removeOptOut } from "@/lib/optout";
import { cloudSessionIds } from "@/modules/whatsapp/provider";
import type { InboundConsumer } from "@/modules/whatsapp/cloud/inbound-handler";
import type { InboundMessage, NormalizedBatch } from "@/modules/whatsapp/cloud/inbound";
import { BoundedTtlMap } from "@/modules/integracao/comanda/state";
import { MSG_RESPONSAVEL_AVISADO, PAUSA_HORAS, pausadaAgora } from "./dono";
import { MAX_TEXTO } from "./constantes";
import { extrairCodigoLoja } from "./loja";
import { prismaStore, SEM_LOJA, type ConversaRef, type IaStore } from "./store";

/**
 * Consumidor de ENTRADA da IA (fase 1): recebe os eventos normalizados do webhook da Meta e cuida de tudo
 * que vem ANTES da IA: idempotência (a Meta reenvia), ordem, rate limit, opt-out, tipos não suportados,
 * descoberta da loja (código do link) e pausa. Quem de fato responde às dúvidas é o `responder` injetado
 * (o motor da IA, Task 6). Sem `responder`, o consumidor só registra a mensagem e não responde nada.
 *
 * LIGADO SÓ POR OPÇÃO: sem IA_ATENDIMENTO=on nada acontece (padrão), mesmo se o consumidor estiver registrado.
 * Nunca registra conteúdo de mensagem nem telefone: só contagens.
 */

export type Responder = (entrada: {
    conversa: ConversaRef;
    texto: string;
    nomePerfil: string | null;
    contactKey: string;
}) => Promise<string | null>;

export interface IaDeps {
    store: IaStore;
    /** Envia texto livre ao cliente (dentro da janela de 24 h). Devolve o id da mensagem, se houver. */
    enviar: (contactKey: string, texto: string) => Promise<string | null>;
    responder?: Responder;
    /** Trata "LIBERAR #CODIGO" do responsável: devolve o texto de confirmação, ou null se não for um pedido válido. */
    liberar?: (texto: string, contactKey: string) => Promise<string | null>;
    optOut: {
        is: (sessionId: string, jid: string) => Promise<boolean>;
        add: (sessionId: string, jid: string) => Promise<void>;
        remove: (sessionId: string, jid: string) => Promise<void>;
    };
    env: Record<string, string | undefined>;
    now: () => Date;
    logger: { info: (tag: string, msg: string) => void; warn: (tag: string, msg: string) => void };
    /** Ids de mensagem já vistos (memória; a garantia forte é a coluna única no banco). */
    vistos: BoundedTtlMap<true>;
    /** Quem já recebeu a orientação "use o link da loja" (uma vez por dia). */
    orientados: BoundedTtlMap<true>;
    /** Quem já recebeu o aviso de tipo não suportado. */
    avisadosTipo: BoundedTtlMap<true>;
    /** Conversas pausadas cujo cliente já recebeu "o responsável foi avisado". */
    avisadosPausa: BoundedTtlMap<true>;
    /** Marcas de tempo (ms) das mensagens recentes por cliente, para o rate limit. */
    recentes: BoundedTtlMap<number[]>;
}

export const LIMITE_POR_MINUTO = 8;
export const LIMITE_POR_HORA = 60;
export { MAX_TEXTO };

const TAG = "IaAtendimento";
const DIA = 24 * 60 * 60 * 1000;

export const MSG_ORIENTACAO = "Olá! Para eu te ajudar, abra a conversa pelo link ou QR code da loja. Assim eu sei de qual loja você está falando.";
export const MSG_TIPO_NAO_SUPORTADO = "Por enquanto eu só consigo ler mensagens de texto. Pode escrever sua dúvida?";
export const MSG_PARAR = "Tudo certo, não vou mais te responder por aqui. Se mudar de ideia, mande VOLTAR.";
export const MSG_VOLTAR = "Que bom ter você de volta! Como posso ajudar?";

const TIPOS_TEXTO = new Set(["text", "button_reply", "list_reply"]);

export function criarDepsPadrao(over: Partial<IaDeps> = {}): IaDeps {
    return {
        store: prismaStore,
        enviar: async () => null,
        optOut: { is: isOptedOut, add: addOptOut, remove: removeOptOut },
        env: process.env,
        now: () => new Date(),
        logger: defaultLogger,
        vistos: new BoundedTtlMap<true>(20_000, DIA),
        orientados: new BoundedTtlMap<true>(10_000, DIA),
        avisadosTipo: new BoundedTtlMap<true>(10_000, 60 * 60 * 1000),
        avisadosPausa: new BoundedTtlMap<true>(10_000, PAUSA_HORAS * 60 * 60 * 1000),
        recentes: new BoundedTtlMap<number[]>(10_000, 60 * 60 * 1000),
        ...over,
    };
}

/** true se passou do limite (e então a mensagem é descartada sem resposta). Conta a tentativa. */
function estourouLimite(deps: IaDeps, contactKey: string, agoraMs: number): boolean {
    const marcas = (deps.recentes.get(contactKey) ?? []).filter((t) => agoraMs - t < 60 * 60 * 1000);
    const naUltimaMinuto = marcas.filter((t) => agoraMs - t < 60 * 1000).length;
    const estourou = naUltimaMinuto >= LIMITE_POR_MINUTO || marcas.length >= LIMITE_POR_HORA;
    if (!estourou) marcas.push(agoraMs);
    deps.recentes.set(contactKey, marcas);
    return estourou;
}

/** Hash curto do contato, só para correlacionar em log sem expor o telefone. */
export const hashContato = (contactKey: string) => crypto.createHash("sha256").update(contactKey).digest("hex").slice(0, 8);

export function criarConsumidorIa(over: Partial<IaDeps> = {}): InboundConsumer {
    const deps = criarDepsPadrao(over);

    async function responderTexto(contactKey: string, conversa: ConversaRef | null, texto: string): Promise<void> {
        try {
            const id = await deps.enviar(contactKey, texto);
            if (conversa) {
                await deps.store.registrarMensagem({
                    lojaCodigo: conversa.lojaCodigo, contactKey, providerMessageId: id ?? `out:${crypto.randomUUID()}`, texto, direcao: "out", em: deps.now(),
                });
            }
        } catch (e) {
            // sem telefone, texto nem mensagem do erro: só o tipo
            deps.logger.warn(TAG, `envio falhou: ${e instanceof Error ? e.name : "erro"}`);
        }
    }

    async function tratar(m: InboundMessage, sessionId: string | null, c: { ignoradas: number; limitadas: number }): Promise<void> {
        if (deps.vistos.has(m.messageId)) {
            c.ignoradas++;
            return;
        }

        const contactKey = m.from.contactKey;
        const jid = `${contactKey}@s.whatsapp.net`;
        const emTexto = TIPOS_TEXTO.has(m.type);
        const texto = emTexto ? (m.text ?? "") : "";

        if (estourouLimite(deps, contactKey, deps.now().getTime())) {
            c.limitadas++;
            return;
        }

        // Quem pediu para parar não recebe mais nada (nem é registrado), a menos que escreva VOLTAR.
        const descadastrado = sessionId ? await deps.optOut.is(sessionId, jid) : false;
        if (descadastrado && !isOptInText(texto)) {
            c.ignoradas++;
            return;
        }

        // Toda mensagem aceita é gravada ANTES de qualquer resposta: é ela que abre a janela de 24 h da Cloud API.
        // Sem loja, vai para a conversa "sem loja" (sem guardar o conteúdo).
        const codigo = extrairCodigoLoja(texto);
        const loja = codigo ?? (await deps.store.lojaDaConversa(contactKey));
        const semLoja = !loja;
        const registro = await deps.store.registrarMensagem({
            lojaCodigo: loja ?? SEM_LOJA, contactKey, providerMessageId: m.messageId,
            texto: semLoja || !emTexto ? `[${semLoja ? "sem loja" : m.type}]` : texto.slice(0, MAX_TEXTO), direcao: "in", em: m.timestamp,
        });
        // só depois de gravar: se a gravação falhar, a reentrega da Meta ainda é processada (não fica marcada como vista)
        deps.vistos.set(m.messageId, true);
        if (!registro.novo) {
            c.ignoradas++; // reentrega da Meta já gravada
            return;
        }

        if (emTexto && deps.liberar) {
            const confirmacao = await deps.liberar(texto, contactKey);
            if (confirmacao !== null) {
                await responderTexto(contactKey, registro.conversa, confirmacao);
                return;
            }
        }

        if (sessionId && isOptInText(texto)) {
            await deps.optOut.remove(sessionId, jid);
            await responderTexto(contactKey, registro.conversa, MSG_VOLTAR);
            return;
        }
        if (sessionId && isOptOutText(texto)) {
            await deps.optOut.add(sessionId, jid);
            await responderTexto(contactKey, registro.conversa, MSG_PARAR);
            return;
        }

        if (!emTexto) {
            if (!deps.avisadosTipo.has(contactKey)) {
                deps.avisadosTipo.set(contactKey, true);
                await responderTexto(contactKey, registro.conversa, MSG_TIPO_NAO_SUPORTADO);
            }
            return;
        }

        if (semLoja) {
            if (!deps.orientados.has(contactKey)) {
                deps.orientados.set(contactKey, true);
                await responderTexto(contactKey, registro.conversa, MSG_ORIENTACAO);
            }
            return;
        }

        const conv = registro.conversa;
        if (conv.estado === "humano") {
            if (pausadaAgora(conv, deps.now())) {
                // o responsável assumiu: a IA fica calada; o cliente é avisado uma única vez
                if (!deps.avisadosPausa.has(conv.id)) {
                    deps.avisadosPausa.set(conv.id, true);
                    await responderTexto(contactKey, conv, MSG_RESPONSAVEL_AVISADO);
                }
                return;
            }
            await deps.store.retomar(conv.id); // pausa vencida (12 h): a IA volta sozinha
        }
        if (!deps.responder) return;

        const resposta = await deps.responder({ conversa: registro.conversa, texto: texto.slice(0, MAX_TEXTO), nomePerfil: m.from.name, contactKey });
        if (resposta) await responderTexto(contactKey, registro.conversa, resposta);
    }

    return async (batch: NormalizedBatch) => {
        if (deps.env.IA_ATENDIMENTO?.trim().toLowerCase() !== "on") return; // desligado (padrão)

        const mensagens = batch.events.filter((e): e is InboundMessage => e.kind === "message").sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        if (mensagens.length === 0) return;

        const sessionId = [...cloudSessionIds(deps.env)][0] ?? null;
        const c = { ignoradas: 0, limitadas: 0 };
        for (const m of mensagens) {
            try {
                await tratar(m, sessionId, c);
            } catch (e) {
                // uma mensagem com problema nunca derruba as outras do lote
                deps.logger.warn(TAG, `mensagem não tratada: ${e instanceof Error ? e.name : "erro"}`);
            }
        }
        deps.logger.info(TAG, `lote: mensagens=${mensagens.length} ignoradas=${c.ignoradas} limitadas=${c.limitadas}`);
    };
}
