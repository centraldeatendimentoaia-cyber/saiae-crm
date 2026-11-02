import { logger as defaultLogger } from "@/lib/logger";
import { buscarContexto, type IaContexto, type IaContextoAtivo } from "./comanda-contexto";
import { MAX_TEXTO } from "./constantes";
import type { Responder } from "./consumer";
import { ehPerguntaAlimentar, MSG_ALIMENTAR_AVISADO, MSG_ALIMENTAR_SEM_AVISO } from "./alimentar";
import { executarFerramenta, FERRAMENTAS, type AcoesFerramentas } from "./ferramentas";
import { descreverErro, type Llm, type MensagemLlm } from "./llm";
import { montarPromptPartes } from "./prompt";
import type { ConversaRef, IaStore } from "./store";

/**
 * Motor da IA: monta o contexto REAL da loja (Comanda), conversa com o modelo e executa no máximo MAX_PASSOS rodadas
 * de ferramentas. Devolve o texto a enviar ao cliente, ou `null` para ficar calada (IA desligada na loja, contexto
 * indisponível). Nunca lança e nunca registra texto de cliente, telefone nem resposta: só contagens.
 */

export const MAX_PASSOS = 4;
export const MAX_HISTORICO = 8;
export const MAX_RESPOSTA = 900;
export const mensagemSoLink = (link: string) => `No momento eu só consigo te passar o link do cardápio, onde você faz seu pedido: ${link}`;
export const MSG_FALHA = "Desculpe, não consegui responder agora. Pode tentar de novo em instantes?";

export interface MotorDeps {
    llm: Llm;
    store: Pick<IaStore, "historico">;
    contexto: (codigoLoja: string, telefone: string) => Promise<IaContexto>;
    /** Ações das ferramentas por conversa (Task 7 liga o aviso ao dono). */
    acoes: (conversa: ConversaRef, ctx: IaContextoAtivo) => AcoesFerramentas;
    /** Limite mensal (consumo.ts): "so_link" = só manda o link do cardápio, sem chamar o modelo. Ausente = sem limite. */
    limite?: (conversa: ConversaRef, ctx: IaContextoAtivo) => Promise<"ok" | "so_link">;
    logger: { warn: (tag: string, msg: string) => void };
}

const TAG = "IaMotor";

const TLDS = "com|br|net|org|io|me|ly|gl|co|app|link|xyz|info|ai|tv|ws|gg|to|cc|us|site|online|store|shop|club|dev|page|live|be|im|is|in|ru|cn|top|vip|biz|click|fyi|run";
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const URL_COM_ESQUEMA = /https?:\/\/[^\s)>\]]+/gi;
/** Endereço sem esquema: "www.x.com", "bit.ly/xyz", "wa.me/55..." ou "dominio.com". Não pega preços ("12.50") nem frases coladas ("pedido.Obrigado"). */
const DOMINIO_SOLTO = new RegExp(`(?<![\\w@.-])(?:www\\.[a-z0-9-]+(?:\\.[a-z0-9-]+)+|[a-z0-9-]*[a-z][a-z0-9-]*(?:\\.[a-z0-9-]*[a-z][a-z0-9-]*)*\\.(?:${TLDS})(?![a-z0-9]))(?:[/?#][^\\s)>\\]]*)?`, "gi");

function semLinks(trecho: string): string {
    return trecho.replace(URL_COM_ESQUEMA, "").replace(DOMINIO_SOLTO, "");
}

/**
 * Remove qualquer endereço que não seja o do cardápio da loja: com esquema (http/https), com www., encurtadores
 * (bit.ly/xyz, wa.me/...) e domínios soltos. A IA nunca manda outro destino. O link do cardápio (com ou sem esquema)
 * só vale inteiro: "link.evil.com" ou "link/../x" não passam.
 */
export function filtrarSaida(texto: string, linkCardapio: string): string {
    const permitidos = [linkCardapio, linkCardapio.replace(/^https?:\/\//i, "")].map(escapar).join("|");
    const lista = new RegExp(`(?:${permitidos})(?![\\w-]|\\.[\\w]|/\\.\\.)`, "gi");
    let out = "";
    let ultimo = 0;
    for (const m of texto.matchAll(lista)) {
        out += semLinks(texto.slice(ultimo, m.index)) + m[0];
        ultimo = (m.index ?? 0) + m[0].length;
    }
    out += semLinks(texto.slice(ultimo));
    const limpo = out.replace(/[ \t]{2,}/g, " ").trim();
    return limpo.length > MAX_RESPOSTA ? limpo.slice(0, MAX_RESPOSTA - 1).trimEnd() + "…" : limpo;
}

/** Histórico → mensagens do modelo: textos cortados, papéis consecutivos iguais unidos, começando e terminando no cliente. */
export function montarMensagens(hist: { direcao: "in" | "out"; texto: string }[], textoAtual: string): MensagemLlm[] {
    const msgs: { papel: "user" | "assistant"; texto: string }[] = [];
    for (const h of hist) {
        const papel = h.direcao === "in" ? "user" : "assistant";
        const texto = h.texto.slice(0, MAX_TEXTO);
        const ultimo = msgs[msgs.length - 1];
        if (ultimo && ultimo.papel === papel) ultimo.texto += `\n${texto}`;
        else msgs.push({ papel, texto });
    }
    // a mensagem atual já foi gravada antes de chamar o motor; se por algum motivo não estiver, acrescenta
    const ultimo = msgs[msgs.length - 1];
    if (!ultimo || ultimo.papel !== "user") msgs.push({ papel: "user", texto: textoAtual.slice(0, MAX_TEXTO) });
    while (msgs.length && msgs[0].papel !== "user") msgs.shift();
    return msgs;
}

export function criarResponder(deps: MotorDeps): Responder {
    return async ({ conversa, texto, nomePerfil, contactKey }) => {
        try {
            const telefone = contactKey.replace(/\D/g, "");
            const ctx = await deps.contexto(conversa.lojaCodigo, telefone);
            if (!ctx.ativa) return null;
            // TRAVA DE SEGURANÇA ALIMENTAR (sem modelo): alergia, restrição e composição vão para o responsável, com resposta fixa
            if (ehPerguntaAlimentar(texto)) {
                const avisou = await deps.acoes(conversa, ctx).chamarDono("assunto_sensivel").catch(() => false);
                return avisou === true ? MSG_ALIMENTAR_AVISADO : MSG_ALIMENTAR_SEM_AVISO;
            }
            if (deps.limite && (await deps.limite(conversa, ctx)) === "so_link") return mensagemSoLink(ctx.loja.link_cardapio);

            const hist = await deps.store.historico(conversa.id, MAX_HISTORICO);
            const mensagens = montarMensagens(hist, texto);
            const prompt = montarPromptPartes(ctx, { nomePerfil, primeiraResposta: !hist.some((h) => h.direcao === "out") });
            const acoes = deps.acoes(conversa, ctx);

            for (let passo = 0; passo < MAX_PASSOS; passo++) {
                const saida = await deps.llm.responder({ sistema: prompt.estavel, sistemaVariavel: prompt.variavel, mensagens, ferramentas: FERRAMENTAS });
                if (saida.chamadas.length === 0) {
                    const final = saida.texto ? filtrarSaida(saida.texto, ctx.loja.link_cardapio) : "";
                    if (!final) {
                        deps.logger.warn(TAG, "modelo sem resposta utilizável");
                        return MSG_FALHA;
                    }
                    return final;
                }
                mensagens.push({ papel: "assistant", texto: saida.texto, chamadas: saida.chamadas });
                const resultados = [];
                for (const c of saida.chamadas) {
                    const r = await executarFerramenta(c.nome, c.argumentos, ctx, acoes);
                    resultados.push({ id: c.id, texto: r.texto, ...(r.erro ? { erro: true } : {}) });
                }
                mensagens.push({ papel: "tool", resultados });
            }
            deps.logger.warn(TAG, "limite de passos atingido");
            return MSG_FALHA;
        } catch (e) {
            deps.logger.warn(TAG, `falha no motor: ${descreverErro(e)}`);
            return MSG_FALHA;
        }
    };
}

export function motorPadrao(llm: Llm, store: Pick<IaStore, "historico">, acoes?: MotorDeps["acoes"], limite?: MotorDeps["limite"]): Responder {
    return criarResponder({
        llm,
        store,
        contexto: (loja, tel) => buscarContexto(loja, tel),
        acoes: acoes ?? (() => ({ chamarDono: async () => false, registrarPergunta: async () => undefined })),
        limite,
        logger: defaultLogger,
    });
}
