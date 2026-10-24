import type { ComandaEvent } from "./schema";

/**
 * Avisos de status do pedido enviados pelo WhatsApp (Baileys) da própria barraca: tipos, gatilhos, validade e textos.
 */

export type TipoAviso = "recebido" | "pronto" | "saiu_entrega" | "entregue" | "cancelado";

export const TIPOS_AVISO: readonly TipoAviso[] = ["recebido", "pronto", "saiu_entrega", "entregue", "cancelado"];

const MINUTO = 60_000;

/**
 * Validade do aviso, contada do `occurred_at` do evento. Passou disso sem sair (sessão desconectada, teto de envio),
 * o aviso é descartado: "pronto" atrasado horas vira ruído. Valores aprovados pelo João em 23/10/2026.
 */
export const VALIDADE_MS: Record<TipoAviso, number> = {
    recebido: 30 * MINUTO,
    pronto: 15 * MINUTO,
    saiu_entrega: 15 * MINUTO,
    entregue: 15 * MINUTO,
    cancelado: 60 * MINUTO,
};

export const TEXTO_MAX = 500;

export const TEXTO_PADRAO: Record<TipoAviso, string> = {
    recebido: "Olá {nome}! Recebemos seu pedido {senha} na {barraca}. Avisamos assim que estiver pronto.",
    pronto: "Olá {nome}! Seu pedido {senha} da {barraca} está pronto. Pode retirar!",
    saiu_entrega: "Olá {nome}! Seu pedido {senha} da {barraca} saiu para entrega.",
    entregue: "Olá {nome}! Seu pedido {senha} da {barraca} foi entregue. Obrigado e bom apetite!",
    cancelado: "Olá {nome}! Seu pedido {senha} da {barraca} foi cancelado. Se tiver dúvida, é só responder esta mensagem.",
};

/** "Pronto" de um pedido de entrega quer dizer que o entregador vai retirar, não que o cliente pode buscar. */
export const TEXTO_PADRAO_PRONTO_ENTREGA = "Olá {nome}! Seu pedido {senha} da {barraca} está pronto e já vai sair para a entrega.";

/**
 * Qual aviso o evento gera. null = nenhum.
 * "Entregue" vem de `order.status_changed` com `data.status = "entregue"`; o filtro de "nasceu entregue" e de
 * correção de status é feito pelo registro (ver aviso-registro.ts).
 */
export function tipoDoEvento(event: ComandaEvent): TipoAviso | null {
    switch (event.type) {
        case "order.created":
            return "recebido";
        case "order.ready":
            return "pronto";
        case "order.out_for_delivery":
            return "saiu_entrega";
        case "order.cancelled":
            return "cancelado";
        case "order.status_changed":
            return (event.data as { status?: unknown }).status === "entregue" ? "entregue" : null;
        default:
            return null;
    }
}

export interface ConfigAviso {
    ativo: boolean;
    texto: string | null;
}

/**
 * Lê `data.avisos[tipo]` do evento (campo aditivo). Ausente ou malformado = ativo, com o texto padrão.
 * Só `ativo === false` desliga; o texto é cortado em TEXTO_MAX e texto em branco vale como ausente.
 */
export function configDoAviso(data: Record<string, unknown>, tipo: TipoAviso): ConfigAviso {
    const avisos = data.avisos;
    const cfg = avisos && typeof avisos === "object" ? (avisos as Record<string, unknown>)[tipo] : undefined;
    if (!cfg || typeof cfg !== "object") return { ativo: true, texto: null };
    const { ativo, texto } = cfg as { ativo?: unknown; texto?: unknown };
    const limpo = typeof texto === "string" ? texto.trim().slice(0, TEXTO_MAX) : "";
    return { ativo: ativo !== false, texto: limpo || null };
}

export interface ValoresMensagem {
    nome?: string | null;
    senha?: number | string | null;
    barraca: string;
}

function primeiroNome(nome: string | null | undefined): string {
    return (nome ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * Preenche {nome} {senha} {barraca}. Variável sem valor some junto do espaço antes dela ("Olá {nome}!" sem nome vira
 * "Olá!"). Mesmo comportamento de `montarMensagemPronto`, no app do Sai aê (src/lib/avisoPronto.ts).
 */
export function montarMensagem(modelo: string, valores: ValoresMensagem): string {
    const nome = primeiroNome(valores.nome);
    const senha = valores.senha === null || valores.senha === undefined || valores.senha === "" ? "" : `#${valores.senha}`;
    let texto = modelo;
    const trocar = (chave: string, valor: string) => {
        texto = valor ? texto.split(chave).join(valor) : texto.replace(new RegExp(`\\s*${chave.replace(/[{}]/g, "\\$&")}`, "g"), "");
    };
    trocar("{nome}", nome);
    trocar("{senha}", senha);
    trocar("{barraca}", valores.barraca.trim());
    return texto
        .replace(/\s+([!?.,])/g, "$1")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/^[\s,;:]+/, "")
        .trim();
}

/** Texto final do aviso: o da barraca, se houver, senão o padrão do tipo (e do atendimento, no "pronto"). */
export function textoDoAviso(tipo: TipoAviso, personalizado: string | null, entrega: boolean): string {
    if (personalizado) return personalizado;
    return tipo === "pronto" && entrega ? TEXTO_PADRAO_PRONTO_ENTREGA : TEXTO_PADRAO[tipo];
}
