import crypto from "crypto";
import { z } from "zod";
import type { DefinicaoFerramenta } from "@/modules/ia-atendimento/llm";
import { escolhaDeConfirmacao } from "./afirmativo";
import { RESUMO_VALE_MS, type ConversaBot } from "./estado";
import type { AcaoSaiae, Cardapio, RespostaSaiae } from "./saiae";

/**
 * Ferramentas do bot. Regras de segurança, todas em código (o modelo só pede):
 * - preço e total vêm SÓ do retorno do resolver (`rascunho`), formatados aqui; `ver_cardapio` não mostra preço;
 * - `confirmar_pedido` só passa se o último envio do bot foi o resumo vigente E a mensagem atual do cliente é um
 *   "sim" (ou "pix") verificado por `escolhaDeConfirmacao`; o resumo precisa ser o que o cliente de fato recebeu
 *   (`hashMostrado`, definido pelo motor só depois do envio); o `client_uuid` nasce com o rascunho (um por rascunho),
 *   então reenviar o mesmo "sim" nunca cria dois pedidos e um pedido idêntico futuro não colide com o anterior.
 * Anotado, sem implementar: a franquia (`contarConversa`) só conta conversa nova e não limita o gasto de um mesmo
 * contato; `chamar_dono` pode ser usado em volume para incomodar o dono (o limite por minuto/hora já ajuda).
 */

export const MOTIVOS_DONO = ["pedido_humano", "reclamacao", "duvida", "entrega", "outro"] as const;
const TEXTO_MOTIVO: Record<(typeof MOTIVOS_DONO)[number], string> = {
    pedido_humano: "quer falar com uma pessoa",
    reclamacao: "reclamação",
    duvida: "dúvida que o bot não soube responder",
    entrega: "quer entrega",
    outro: "precisa de ajuda",
};

export const FERRAMENTAS: DefinicaoFerramenta[] = [
    {
        nome: "ver_cardapio",
        descricao: "Lista os itens do cardápio com item_id, grupos de opções e opcao_id (sem preços). Use para achar o que o cliente pediu.",
        esquema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        nome: "montar_rascunho",
        descricao: "Monta o resumo do pedido para o cliente conferir. O sistema calcula os preços e envia o resumo; você não escreve valores.",
        esquema: {
            type: "object",
            properties: {
                itens: {
                    type: "array",
                    maxItems: 40,
                    items: {
                        type: "object",
                        properties: {
                            item_id: { type: "string" },
                            quantidade: { type: "integer", minimum: 1, maximum: 99 },
                            opcao_ids: { type: "array", items: { type: "string" } },
                            observacao: { type: "string", maxLength: 140 },
                        },
                        required: ["item_id", "quantidade"],
                        additionalProperties: false,
                    },
                },
            },
            required: ["itens"],
            additionalProperties: false,
        },
    },
    {
        nome: "confirmar_pedido",
        descricao: "Registra o pedido do último resumo. Só funciona se o cliente acabou de responder SIM (ou PIX) ao resumo. Sem argumentos.",
        esquema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        nome: "chamar_dono",
        descricao: "Avisa o responsável da loja para assumir a conversa (reclamação, pedido de falar com pessoa, dúvida sem resposta, entrega).",
        esquema: { type: "object", properties: { motivo: { type: "string", enum: [...MOTIVOS_DONO] } }, required: ["motivo"], additionalProperties: false },
    },
];

export interface ContextoFerramentas {
    sessionId: string;
    contactKey: string;
    nome: string | null;
    /** Texto da mensagem que o cliente acabou de mandar. */
    textoAtual: string;
    /** O último envio do bot foi o resumo (antes desta mensagem). */
    aguardava: boolean;
    barracaId: string;
    cardapio: Cardapio;
    conversa: ConversaBot;
    agora: number;
    saiae: (acao: AcaoSaiae, corpo: Record<string, unknown>) => Promise<RespostaSaiae>;
    /** Manda texto ao WhatsApp do responsável da loja. */
    avisarDono: (texto: string) => Promise<boolean>;
    pausar: () => void;
    /** Mensagens montadas por código: se houver, substituem o texto do modelo. */
    respostas: string[];
    /** O resumo foi enviado nesta rodada: o próximo "sim" vale. */
    resumoEnviado: boolean;
    /** Falha retentável ao confirmar: o rascunho voltou e o próximo "sim" tenta de novo. */
    retentar: boolean;
}

/** Nome do WhatsApp sem quebra de linha/controle e com limite (vai ao Sai aê e ao aviso do dono). */
export function limparNome(nome: string | null | undefined, padrao: string): string {
    const l = (nome ?? "").replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
    return l || padrao;
}

const CODIGOS_RETENTAVEIS = new Set(["indisponivel", "provedor_indisponivel", "resposta_invalida"]);

export interface ResultadoFerramenta {
    texto: string;
    erro?: boolean;
}

export const brl = (centavos: number): string => `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

const itemArg = z.object({
    item_id: z.string().min(1).max(100),
    quantidade: z.number().int().min(1).max(99),
    opcao_ids: z.array(z.string().max(100)).max(30).default([]),
    observacao: z.string().max(140).default(""),
});
const argsRascunho = z.object({ itens: z.array(itemArg).min(1).max(40) });
const argsDono = z.object({ motivo: z.enum(MOTIVOS_DONO) });

export function listarCardapio(c: Cardapio): string {
    const linhas = c.itens.map((i) => {
        const grupos = i.grupos.map((g) => `${g.nome}${g.minimo ? " (obrigatório)" : ""}: ${g.opcoes.map((o) => `${o.opcao_id}=${o.nome}`).join(", ")}`).join(" | ");
        return `${i.item_id} | ${i.nome}${i.categoria ? ` [${i.categoria}]` : ""}${i.esgotado ? " ESGOTADO" : ""}${grupos ? ` | opções: ${grupos}` : ""}`;
    });
    return linhas.join("\n").slice(0, 8000) || "Cardápio vazio.";
}

type Linha = { nome_item?: unknown; quantidade?: unknown; preco_centavos_unitario?: unknown; opcoes?: unknown; observacao?: unknown };

/** Resumo para o cliente, montado só com o que o resolver devolveu. */
export function montarResumo(linhas: Linha[], total: number, pagamentos: { na_entrega: boolean; pix: boolean }): string {
    const itens = linhas.map((l) => {
        const opcoes = Array.isArray(l.opcoes) ? l.opcoes.map((o) => (typeof o === "string" ? o : (o as { nome?: string })?.nome)).filter(Boolean).join(", ") : "";
        const obs = typeof l.observacao === "string" && l.observacao.trim() ? ` - ${l.observacao.trim()}` : "";
        return `${l.quantidade}x ${l.nome_item}${opcoes ? ` (${opcoes})` : ""}${obs}: ${brl(Number(l.preco_centavos_unitario))} cada`;
    });
    const como = pagamentos.na_entrega && pagamentos.pix ? "Responda SIM para pagar na retirada ou PIX para pagar agora." : pagamentos.pix ? "Responda SIM para pagar agora por Pix." : "Responda SIM para confirmar (pagamento na retirada).";
    return `Seu pedido (retirada):\n${itens.join("\n")}\nTotal: ${brl(total)}\n\n${como}`;
}

const linkMsg = (c: Cardapio, inicio: string) => `${inicio} ${c.loja.link_cardapio}`;

export async function executarFerramenta(nome: string, argumentos: unknown, ctx: ContextoFerramentas): Promise<ResultadoFerramenta> {
    const { loja } = ctx.cardapio;
    switch (nome) {
        case "ver_cardapio":
            return { texto: listarCardapio(ctx.cardapio) };

        case "montar_rascunho": {
            const a = argsRascunho.safeParse(argumentos);
            if (!a.success) return { texto: "Argumentos inválidos.", erro: true };
            const r = await ctx.saiae("rascunho", { itens: a.data.itens });
            ctx.conversa.rascunho = null; // um rascunho novo (ou falho) sempre invalida o anterior
            ctx.conversa.hashMostrado = null;
            ctx.aguardava = false; // o "sim" desta rodada era para o resumo antigo, não para este
            if (!r.ok) {
                const erros = Array.isArray(r.erros) ? (r.erros as { mensagem?: unknown }[]).map((e) => (typeof e.mensagem === "string" ? e.mensagem : "item inválido")).slice(0, 5) : [];
                return { texto: `Não consegui montar o pedido (${r.codigo}): ${erros.join("; ") || "sem detalhe"}. Diga ao cliente que não achou e mande o link do cardápio.`, erro: true };
            }
            const linhas = Array.isArray(r.linhas) ? (r.linhas as Linha[]) : [];
            const total = Number(r.total_centavos);
            if (!linhas.length || !Number.isInteger(total) || total < 0) return { texto: "Resposta do sistema inválida.", erro: true };
            const hash = crypto.createHash("sha256").update(JSON.stringify({ itens: a.data.itens, total })).digest("hex");
            ctx.conversa.rascunho = { hash, itens: a.data.itens, totalCentavos: total, criadoEm: ctx.agora, clientUuid: crypto.randomUUID(), barracaId: ctx.barracaId };
            ctx.respostas.push(montarResumo(linhas, total, loja.pagamentos));
            ctx.resumoEnviado = true;
            return { texto: "Resumo montado e enviado ao cliente pelo sistema. Não escreva valores nem repita o resumo." };
        }

        case "confirmar_pedido": {
            const r = ctx.conversa.rascunho;
            if (r && r.barracaId !== ctx.barracaId) ctx.conversa.rascunho = null; // rascunho de outra loja nunca vale
            if (!ctx.aguardava || !r || r.barracaId !== ctx.barracaId || r.hash !== ctx.conversa.hashMostrado || ctx.agora - r.criadoEm > RESUMO_VALE_MS) return { texto: "Recusado: não há resumo vigente aguardando confirmação. Monte o rascunho e peça a confirmação.", erro: true };
            const escolha = escolhaDeConfirmacao(ctx.textoAtual, loja.pagamentos);
            if (!escolha) return { texto: "Recusado: o cliente não respondeu SIM (ou PIX) ao resumo.", erro: true };
            if (!loja.modos.includes("retirada")) {
                ctx.respostas.push(linkMsg(ctx.cardapio, "Por aqui só anoto retirada. Faça seu pedido pelo cardápio:"));
                return { texto: "Loja sem retirada.", erro: true };
            }
            if (!loja.aberta_agora) {
                ctx.respostas.push(linkMsg(ctx.cardapio, "Estamos fechados agora. Veja o cardápio:"));
                return { texto: "Loja fechada.", erro: true };
            }
            const corpo = {
                client_uuid: r.clientUuid,
                itens: r.itens,
                cliente_nome: limparNome(ctx.nome, "Cliente"),
                cliente_telefone: ctx.contactKey,
                tipo_atendimento: "retirada",
                total_esperado_centavos: r.totalCentavos,
            };
            // Toma o rascunho antes do await: uma segunda confirmação concorrente não o encontra.
            ctx.conversa.rascunho = null;
            const pix = escolha === "pix";
            const p = await ctx.saiae(pix ? "pix" : "pedido", pix ? { ...corpo, conversa_id: crypto.createHash("sha256").update(`${ctx.sessionId}:${ctx.contactKey}`).digest("hex").slice(0, 24) } : corpo);
            if (!p.ok && p.codigo === "total_mudou") return totalMudou(ctx);
            if (!p.ok || (pix ? typeof p.copia_cola !== "string" : p.senha === undefined)) {
                const codigo = p.ok ? "resposta_invalida" : p.codigo;
                if (CODIGOS_RETENTAVEIS.has(codigo) && !ctx.conversa.rascunho) {
                    ctx.conversa.rascunho = r; // o mesmo rascunho (e o mesmo client_uuid) volta para a retentativa
                    ctx.retentar = true;
                }
                return falhar(ctx, codigo);
            }
            // O total devolvido tem de ser o do resumo que o cliente viu; senão nada de copia-e-cola nem confirmação.
            if (!Number.isInteger(p.total_centavos) || p.total_centavos !== r.totalCentavos) return totalMudou(ctx);
            ctx.conversa.hashMostrado = null;
            if (pix) {
                const ate = typeof p.expira_em === "string" ? horaSp(p.expira_em) : null;
                ctx.respostas.push(`Pedido de ${brl(r.totalCentavos)} reservado. Pague com o Pix copia e cola${ate ? ` até ${ate}` : ""}. O pedido entra assim que o pagamento cair:`, p.copia_cola as string);
                return { texto: "Pix gerado e enviado ao cliente." };
            }
            ctx.respostas.push(`Pedido anotado! Sua senha é ${String(p.senha)}. Total ${brl(r.totalCentavos)}, pagamento na retirada. Obrigado!`);
            return { texto: "Pedido criado e confirmado ao cliente pelo sistema." };
        }

        case "chamar_dono": {
            const a = argsDono.safeParse(argumentos);
            if (!a.success) return { texto: "Motivo inválido.", erro: true };
            const aviso = `Atendimento por mensagem: ${limparNome(ctx.nome, "um cliente")} ${TEXTO_MOTIVO[a.data.motivo]}. Responda pela conversa no WhatsApp.`;
            const dono = loja.whatsapp_dono?.replace(/\D/g, "");
            if (!dono || !(await ctx.avisarDono(aviso))) {
                ctx.respostas.push(linkMsg(ctx.cardapio, "Não consegui chamar o responsável agora. Você pode fazer o pedido pelo cardápio:"));
                return { texto: "Não foi possível avisar o responsável.", erro: true };
            }
            ctx.pausar();
            ctx.respostas.push(linkMsg(ctx.cardapio, "Avisei o responsável, ele vai te responder por aqui. Enquanto isso, o cardápio está em:"));
            return { texto: "Responsável avisado; o bot fica calado nesta conversa." };
        }

        default:
            return { texto: "Ferramenta desconhecida.", erro: true };
    }
}

/** O valor mudou entre o resumo e a confirmação: nada é confirmado, o cliente pede um resumo novo. */
function totalMudou(ctx: ContextoFerramentas): ResultadoFerramenta {
    ctx.conversa.rascunho = null;
    ctx.conversa.hashMostrado = null;
    ctx.respostas.push("O valor do pedido mudou desde o resumo, então não confirmei. Me diga de novo o que você quer que eu monto um resumo novo.");
    return { texto: "Recusado: o total mudou. Nada foi confirmado.", erro: true };
}

/** Qualquer recusa do Sai aê ao confirmar vira "use o cardápio"; nada de tentar de novo por conta própria. */
function falhar(ctx: ContextoFerramentas, codigo: string): ResultadoFerramenta {
    const inicio = codigo === "fechado" ? "Estamos fechados agora. Veja o cardápio:" : ctx.retentar ? "Não consegui anotar agora. Responda SIM para eu tentar de novo ou faça seu pedido pelo cardápio:" : "Não consegui anotar por aqui. Faça seu pedido pelo cardápio:";
    ctx.respostas.push(linkMsg(ctx.cardapio, inicio));
    return { texto: `Recusado pelo sistema (${codigo}).`, erro: true };
}

function horaSp(iso: string): string | null {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}
