import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { salvarRascunho } from "./armazenamento";
import { aplicarSugestao } from "./editor";
import { usarAtendenteNovo } from "./integracao";
import { CONTROLE, TreinoSchema } from "./treino";

/**
 * Sugestões de treino tiradas das respostas da equipe: quando uma pessoa responde um cliente pelo celular numa sessão
 * com treino publicado, o par (mensagem do cliente, resposta da pessoa) fica pendente. Só o dono, pela tela de treino,
 * aprova (vai para o RASCUNHO, nunca para o publicado) ou descarta. Nenhum caminho do agente aprova sozinho.
 */

const TAG = "Atendente";
export const MIN_RESPOSTA = 15;
export const MAX_CLIENTE = 1000;
export const MAX_RESPOSTA = 2000;
/** Teto de pendentes por sessão: sem isso a tabela cresceria sem limite enquanto o dono não revisa. */
export const MAX_PENDENTES = 200;
/** A resposta da pessoa só conta como correção se a última mensagem do cliente chegou até 30 min antes. */
export const JANELA_CORRECAO_MS = 30 * 60_000;

export type DestinoSugestao = "exemplo" | "base";

/** Erro com o status HTTP que a rota devolve. */
export class ErroSugestao extends Error {
    constructor(message: string, readonly status: 404 | 409) {
        super(message);
        this.name = "ErroSugestao";
    }
}

/** Dias em que uma sugestão descartada ainda impede a mesma (cliente, resposta) de voltar. */
export const DIAS_DESCARTE = 90;

const CONTROLE_G = new RegExp(CONTROLE.source, "g");
const JID = /[\w.:-]+@(?:s\.whatsapp\.net|c\.us|g\.us|lid|broadcast|newsletter)\b/gi;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*/gu;
// "ana @ gmail . com": espaço de algum lado do @ e pelo menos um ponto no domínio.
const EMAIL_ESPACADO = /[\p{L}\p{N}._%+-]+(?:\s+@\s*|\s*@\s+)[\p{L}\p{N}-]+(?:\s*\.\s*[\p{L}\p{N}-]+)+/gu;
// Data dd.mm.aaaa ou dd/mm/aaaa fica de fora (grupo 1); qualquer outra sequência de dígitos com separadores é candidata.
const DATA = /\b\d{1,2}([./])\d{1,2}\1\d{4}\b/gu;
const NUMERO_OU_DATA = /(\b\d{1,2}([./])\d{1,2}\2\d{4}\b)|\+?\(?\d(?:[\s.\-_/,·()]*\d)+/gu;
const MARCADOR = /\[(?:telefone|e-mail|contato)\]/g;

// Varredura final, depois de mascarar: qualquer acerto descarta a sugestão inteira (vazamento aqui é problema de privacidade).
const RESTO = [
    /\d(?:[\s.\-_/,·()]*\d){7,}/u, // 8+ dígitos com ou sem separadores
    /[\p{L}\p{N}]@|@[\p{L}\p{N}]/u, // @ colado em letra ou dígito: e-mail, @perfil
    /@(?:s\.whatsapp\.net|c\.us|g\.us|lid|broadcast|newsletter)\b/i, // JID
    /https?:\/\/\S*?(?:\?|\/[^\s/?#]{20,})/i, // link com query ou trecho com cara de token
];

/** true se o texto (já mascarado) ainda tem algo com cara de contato. Datas dd.mm.aaaa / dd/mm/aaaa não contam. */
export function contemDadoDeContato(texto: string): boolean {
    const semDatas = texto.replace(DATA, " ");
    return RESTO.some((r) => r.test(semDatas));
}

/** Troca JID, e-mail (inclusive acentuado, sem ponto ou espaçado) e números de 8+ dígitos (telefone, CPF, CNPJ) por marcadores. */
export function mascararDados(texto: string): string {
    return texto
        .replace(JID, "[contato]")
        .replace(EMAIL, "[e-mail]")
        .replace(EMAIL_ESPACADO, "[e-mail]")
        .replace(NUMERO_OU_DATA, (m, data?: string) => (!data && m.replace(/\D/g, "").length >= 8 ? "[telefone]" : m));
}

const cortar = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Texto limpo e mascarado, ou null quando não dá para garantir que não sobrou dado de contato. */
function preparar(texto: string, max: number): string | null {
    const limpo = mascararDados(texto.replace(CONTROLE_G, "").replace(/\r\n?/g, "\n").trim());
    if (!limpo || contemDadoDeContato(limpo)) return null;
    return cortar(limpo, max);
}

/** Tamanho do que sobra sem os marcadores: resposta que era só um telefone não ensina nada. */
const tamanhoUtil = (s: string) => s.replace(MARCADOR, "").trim().length;

const tetoAvisado = new Set<string>();

/** Grava uma sugestão pendente. Nunca lança: qualquer falha só vira aviso no log. */
export async function criarSugestao(sessionId: string, cliente: string, respostaHumana: string): Promise<void> {
    try {
        if ((respostaHumana ?? "").trim().length < MIN_RESPOSTA) return;
        const c = preparar(cliente ?? "", MAX_CLIENTE);
        const r = preparar(respostaHumana, MAX_RESPOSTA);
        if (!c || !r || tamanhoUtil(r) < MIN_RESPOSTA) return;
        if ((await prisma.atendenteSugestao.count({ where: { sessionId, status: "pendente" } })) >= MAX_PENDENTES) {
            if (!tetoAvisado.has(sessionId)) logger.warn(TAG, `sessão ${sessionId} chegou a ${MAX_PENDENTES} sugestões pendentes; novas são ignoradas até o dono revisar`);
            tetoAvisado.add(sessionId);
            return;
        }
        tetoAvisado.delete(sessionId);
        // Igual a uma pendente, ou a uma descartada recentemente (para o que o dono já recusou não voltar).
        const recente = new Date(Date.now() - DIAS_DESCARTE * 86_400_000);
        const repetida = await prisma.atendenteSugestao.findFirst({
            where: { sessionId, cliente: c, resposta: r, OR: [{ status: "pendente" }, { status: "descartada", criadoEm: { gte: recente } }] },
            select: { id: true },
        });
        if (repetida) return;
        await prisma.atendenteSugestao.create({ data: { sessionId, cliente: c, resposta: r } });
    } catch (e) {
        logger.warn(TAG, `não consegui gravar a sugestão de treino: ${(e as { name?: string })?.name ?? "erro"}`);
    }
}

/**
 * Chamado pelo agente quando uma pessoa responde pelo celular. Só age em sessão com treino publicado; pega a última
 * mensagem do cliente na janela e cria a sugestão. Nunca lança e nunca aprova nada.
 * shortcut: cada resposta humana na janela vira uma sugestão (mesma pergunta pode gerar várias); filtrar só a primeira
 * resposta após o cliente se o volume incomodar.
 */
export async function registrarCorrecaoHumana(sessionId: string, jid: string, textoHumano: string, em: Date): Promise<void> {
    try {
        if ((textoHumano ?? "").trim().length < MIN_RESPOSTA) return;
        if (!(await usarAtendenteNovo(sessionId))) return;
        const sessao = await prisma.session.findUnique({ where: { sessionId }, select: { id: true } });
        if (!sessao) return;
        const ultima = await prisma.message.findFirst({
            where: { sessionId: sessao.id, remoteJid: jid, fromMe: false, content: { not: null }, timestamp: { gte: new Date(em.getTime() - JANELA_CORRECAO_MS) } },
            orderBy: { timestamp: "desc" },
            select: { content: true },
        });
        if (!ultima?.content) return;
        await criarSugestao(sessionId, ultima.content, textoHumano);
    } catch (e) {
        logger.warn(TAG, `não consegui registrar a correção da equipe: ${(e as { name?: string })?.name ?? "erro"}`);
    }
}

/** Pendentes da sessão, mais novas primeiro. */
export function listarSugestoesPendentes(sessionId: string) {
    return prisma.atendenteSugestao.findMany({
        where: { sessionId, status: "pendente" },
        orderBy: { criadoEm: "desc" },
        take: 50,
        select: { id: true, cliente: true, resposta: true, criadoEm: true },
    });
}

const JA_TRATADA = "Esta sugestão já foi aprovada ou descartada.";

/**
 * Acrescenta a sugestão ao RASCUNHO (exemplo ou base) e a marca aprovada, tudo numa transação: se o rascunho não puder
 * ser gravado, a sugestão continua pendente. Nunca publica nem cria versão. O rascunho mora na mesma linha que aponta a
 * versão publicada, então "sem rascunho" significa sessão sem treino nenhum.
 * shortcut: o rascunho é lido e regravado sem trava de linha; duas aprovações de sugestões diferentes no mesmo instante
 * podem perder uma (a tela faz uma ação por vez). Usar SELECT ... FOR UPDATE se houver vários editores simultâneos.
 */
export async function aprovarSugestao(sessionId: string, id: string, destino: DestinoSugestao): Promise<void> {
    await prisma.$transaction(async (tx) => {
        const s = await tx.atendenteSugestao.findFirst({ where: { id, sessionId } });
        if (!s) throw new ErroSugestao("Sugestão não encontrada nesta sessão.", 404);
        if (s.status !== "pendente") throw new ErroSugestao(JA_TRATADA, 409);
        const t = await tx.atendenteTreino.findUnique({ where: { sessionId } });
        if (!t) throw new ErroSugestao("Esta sessão ainda não tem rascunho de treino. Salve um rascunho antes de aprovar sugestões.", 409);
        const atual = TreinoSchema.safeParse(t.rascunho);
        if (!atual.success) throw new ErroSugestao("O rascunho salvo está inválido. Corrija e salve o treino antes de aprovar.", 409);
        const novo = aplicarSugestao(atual.data, s, destino);
        if (typeof novo === "string") throw new ErroSugestao(novo, 409);
        // Marca primeiro com condição de "pendente": duas aprovações simultâneas da mesma sugestão não entram duas vezes.
        const { count } = await tx.atendenteSugestao.updateMany({ where: { id, sessionId, status: "pendente" }, data: { status: "aprovada" } });
        if (count !== 1) throw new ErroSugestao(JA_TRATADA, 409);
        await salvarRascunho(sessionId, novo, tx);
    });
}

export async function descartarSugestao(sessionId: string, id: string): Promise<void> {
    const { count } = await prisma.atendenteSugestao.updateMany({ where: { id, sessionId, status: "pendente" }, data: { status: "descartada" } });
    if (count === 1) return;
    const existe = await prisma.atendenteSugestao.findFirst({ where: { id, sessionId }, select: { id: true } });
    throw existe ? new ErroSugestao(JA_TRATADA, 409) : new ErroSugestao("Sugestão não encontrada nesta sessão.", 404);
}
