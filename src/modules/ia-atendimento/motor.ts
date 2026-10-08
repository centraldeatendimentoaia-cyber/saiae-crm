import { logger as defaultLogger } from "@/lib/logger";
import { buscarContexto, type IaContexto, type IaContextoAtivo } from "./comanda-contexto";
import { MAX_TEXTO } from "./constantes";
import type { Responder } from "./consumer";
import { executarFerramenta, FERRAMENTAS, type AcoesFerramentas } from "./ferramentas";
import type { Llm, MensagemLlm } from "./llm";
import { montarPromptSistema } from "./prompt";
import type { ConversaRef, IaStore } from "./store";

/**
 * Motor da IA: monta o contexto REAL da loja (Comanda), conversa com o modelo e executa no máximo MAX_PASSOS rodadas
 * de ferramentas. Devolve o texto a enviar ao cliente, ou `null` para ficar calada (IA desligada na loja, contexto
 * indisponível). Nunca lança e nunca registra texto de cliente, telefone nem resposta: só contagens.
 */

export const MAX_PASSOS = 4;
export const MAX_HISTORICO = 12;
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

/** Remove links que não sejam o do cardápio da loja: a IA nunca manda outro endereço. */
export function filtrarSaida(texto: string, linkCardapio: string): string {
    const limpo = texto.replace(/https?:\/\/[^\s)>\]]+/gi, (u) => (u.startsWith(linkCardapio) ? u : "")).replace(/[ \t]{2,}/g, " ").trim();
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
            if (deps.limite && (await deps.limite(conversa, ctx)) === "so_link") return mensagemSoLink(ctx.loja.link_cardapio);

            const hist = await deps.store.historico(conversa.id, MAX_HISTORICO);
            const mensagens = montarMensagens(hist, texto);
            const sistema = montarPromptSistema(ctx, { nomePerfil, primeiraResposta: !hist.some((h) => h.direcao === "out") });
            const acoes = deps.acoes(conversa, ctx);

            for (let passo = 0; passo < MAX_PASSOS; passo++) {
                const saida = await deps.llm.responder({ sistema, mensagens, ferramentas: FERRAMENTAS });
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
            deps.logger.warn(TAG, `falha no motor: ${(e as { name?: string })?.name ?? "erro"}`);
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
