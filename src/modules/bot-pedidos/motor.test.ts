import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/whatsapp/manager", () => ({ waManager: { getInstance: vi.fn() } }));

import type { EntradaBot } from "./entrada";
import type { Llm, SaidaLlm } from "@/modules/ia-atendimento/llm";
import { criarEstadoBot } from "./estado";
import { filtrarTexto, humanoAssumiu, tratar, type DepsMotor } from "./motor";
import type { Cardapio, RespostaSaiae } from "./saiae";

const SESSAO = "sessao-loja";
const BARRACA = "cd4ac833-86de-4429-83d9-8b24c7ab23db";
const TEL = "5561999990001";
const LINK = "https://app.saiae.com.br/jmal/cardapio";
const T0 = new Date("2026-10-24T15:00:00Z").getTime();

const cardapio = (loja: Partial<Cardapio["loja"]> = {}): Cardapio => ({
    ok: true,
    loja: { nome: "Jmal", link_cardapio: LINK, aberta_agora: true, modos: ["retirada"], pagamentos: { na_entrega: true, pix: true }, whatsapp_dono: "5561988887777", bot_habilitado: true, ...loja },
    itens: [{ item_id: "i1", nome: "Pastel de carne", grupos: [] }],
});

const RASCUNHO_OK: RespostaSaiae = { ok: true, linhas: [{ item_id: "i1", nome_item: "Pastel de carne", quantidade: 2, preco_centavos_unitario: 700, opcoes: [], observacao: "" }], total_centavos: 1400 };

let n = 0;
const entrada = (texto: string, over: Partial<EntradaBot> = {}): EntradaBot => ({ sessionId: SESSAO, barracaId: BARRACA, jid: `${TEL}@s.whatsapp.net`, contactKey: TEL, nome: "Ana", texto, messageId: `M${++n}`, timestamp: T0, ...over });

const chamada = (nome: string, argumentos: unknown = {}): SaidaLlm => ({ chamadas: [{ id: `c${++n}`, nome, argumentos }] });
const fala = (texto: string): SaidaLlm => ({ texto, chamadas: [], uso: { entrada: 100, saida: 20, leituraCache: 0, criacaoCache: 0 } });
const PEDIR = chamada("montar_rascunho", { itens: [{ item_id: "i1", quantidade: 2 }] });

function montar(o: { loja?: Partial<Cardapio["loja"]>; saiae?: Partial<Record<string, RespostaSaiae>>; llm?: SaidaLlm[]; semLlm?: boolean; franquia?: string; total?: number; env?: Record<string, string> } = {}) {
    const estado = criarEstadoBot(() => T0);
    const enviados: { telefone: string; texto: string }[] = [];
    const chamadasSaiae: { acao: string; corpo?: Record<string, unknown> }[] = [];
    const fila = [...(o.llm ?? [])];
    const llm: Llm = { responder: vi.fn(async () => fila.shift() ?? fala("ok")) };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const deps: Partial<DepsMotor> = {
        env: { SAIAE_INTEGRACAO_V1_URL: "https://x/functions/v1/integracao-v1", ...(o.franquia ? { BOT_FRANQUIA_CONVERSAS: o.franquia } : {}), ...o.env },
        now: () => T0,
        logger,
        estado,
        saiae: async (acao, _b, corpo) => {
            chamadasSaiae.push({ acao, corpo });
            if (acao === "cardapio") return cardapio(o.loja);
            return o.saiae?.[acao] ?? { ok: false, codigo: "indisponivel" };
        },
        llm: () => (o.semLlm ? null : llm),
        enviar: vi.fn(async (_s: string, telefone: string, texto: string) => { enviados.push({ telefone, texto }); return true; }),
        optado: vi.fn(async () => false),
        sessaoOcupada: vi.fn(async () => false),
        contarConversa: vi.fn(async () => o.total ?? 1),
        registrarTokens: vi.fn(async () => undefined),
    };
    const run = (e: EntradaBot) => tratar(e, deps);
    const paraCliente = () => enviados.filter((x) => x.telefone === TEL).map((x) => x.texto);
    return { run, deps, estado, enviados, paraCliente, chamadasSaiae, llm, logger };
}

describe("bot de pedidos: quando fica calado", () => {
    it("sem SAIAE_INTEGRACAO_V1_URL não faz nada, nem consulta o Sai aê", async () => {
        const t = montar({ env: { SAIAE_INTEGRACAO_V1_URL: "" } });
        await t.run(entrada("oi"));
        expect(t.enviados).toEqual([]);
        expect(t.chamadasSaiae).toEqual([]);
    });
    it("loja com bot desligado ou erro do Sai aê: silêncio total (continua só com os avisos)", async () => {
        const t = montar({ loja: { bot_habilitado: false } });
        await t.run(entrada("oi"));
        expect(t.enviados).toEqual([]);
        const t2 = montar();
        (t2.deps as { saiae: unknown }).saiae = async () => ({ ok: false, codigo: "indisponivel" });
        await t2.run(entrada("oi"));
        expect(t2.enviados).toEqual([]);
    });
    it("SAIR/VOLTAR ficam com o descadastro (o bot não responde nem processa)", async () => {
        const t = montar();
        await t.run(entrada("SAIR"));
        await t.run(entrada("voltar"));
        expect(t.enviados).toEqual([]);
        expect(t.chamadasSaiae).toEqual([]);
    });
    it("contato em opt-out, conversa pausada para humano e sessão com agente/autoresposta: calado", async () => {
        const t = montar();
        (t.deps.optado as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
        await t.run(entrada("oi"));
        humanoAssumiu(SESSAO, TEL, t.estado);
        await t.run(entrada("oi"));
        const t2 = montar();
        (t2.deps.sessaoOcupada as ReturnType<typeof vi.fn>).mockResolvedValue(true);
        await t2.run(entrada("oi"));
        expect(t.enviados).toEqual([]);
        expect(t2.enviados).toEqual([]);
    });
    it("o mesmo messageId duas vezes responde uma vez só", async () => {
        const t = montar();
        const e = entrada("oi");
        await t.run(e);
        await t.run(e);
        expect(t.paraCliente()).toHaveLength(1);
    });
    it("passou de 8 mensagens por minuto: ignora", async () => {
        const t = montar({ llm: Array.from({ length: 20 }, () => fala("certo")) });
        for (let i = 0; i < 12; i++) await t.run(entrada(`mensagem ${i}`));
        expect(t.paraCliente().length).toBe(8);
    });
});

describe("bot de pedidos: só o link", () => {
    it("saudação manda o link sem usar o modelo", async () => {
        const t = montar();
        await t.run(entrada("Oi!"));
        expect(t.paraCliente()).toHaveLength(1);
        expect(t.paraCliente()[0]).toContain(LINK);
        expect(t.llm.responder).not.toHaveBeenCalled();
    });
    it("loja fechada: só o link, uma vez por dia, e nunca cria pedido", async () => {
        const t = montar({ loja: { aberta_agora: false } });
        await t.run(entrada("quero 2 pasteis"));
        await t.run(entrada("tá aberto?"));
        expect(t.paraCliente()).toHaveLength(1);
        expect(t.paraCliente()[0]).toContain("fechado");
        expect(t.llm.responder).not.toHaveBeenCalled();
    });
    it("franquia mensal estourada volta ao modo só-link", async () => {
        const t = montar({ franquia: "300", total: 301 });
        await t.run(entrada("quero 2 pasteis"));
        expect(t.paraCliente()[0]).toContain(LINK);
        expect(t.llm.responder).not.toHaveBeenCalled();
    });
    it("sem modelo configurado: só o link", async () => {
        const t = montar({ semLlm: true });
        await t.run(entrada("quero 2 pasteis"));
        expect(t.paraCliente()[0]).toContain(LINK);
    });
    it("conta a conversa uma vez e registra os tokens", async () => {
        const t = montar({ llm: [fala("Posso ajudar?"), fala("Claro")] });
        await t.run(entrada("quanto tempo demora?"));
        await t.run(entrada("e fecha que horas?"));
        expect(t.deps.contarConversa).toHaveBeenCalledTimes(1);
        expect(t.deps.registrarTokens).toHaveBeenCalledWith(BARRACA, 120, expect.any(Date));
    });
});

describe("bot de pedidos: pedido por mensagem", () => {
    it("resumo vem do código (preço do resolver), 'sim' cria o pedido, 'sim' repetido não duplica", async () => {
        const t = montar({
            saiae: { rascunho: RASCUNHO_OK, pedido: { ok: true, senha: 42, total_centavos: 1400 } },
            llm: [PEDIR, chamada("confirmar_pedido"), chamada("confirmar_pedido"), fala("Esse pedido já foi anotado.")],
        });
        await t.run(entrada("quero 2 pastéis de carne"));
        expect(t.paraCliente()[0]).toContain("2x Pastel de carne");
        expect(t.paraCliente()[0]).toContain("R$ 7,00 cada");
        expect(t.paraCliente()[0]).toContain("Total: R$ 14,00");

        await t.run(entrada("sim"));
        const pedidos = t.chamadasSaiae.filter((c) => c.acao === "pedido");
        expect(pedidos).toHaveLength(1);
        expect(pedidos[0].corpo).toMatchObject({ cliente_telefone: TEL, tipo_atendimento: "retirada", cliente_nome: "Ana" });
        expect(String(pedidos[0].corpo?.client_uuid)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(t.paraCliente().at(-1)).toContain("senha é 42");

        await t.run(entrada("sim"));
        expect(t.chamadasSaiae.filter((c) => c.acao === "pedido")).toHaveLength(1);
    });
    it("o mesmo resumo gera sempre o mesmo client_uuid (idempotência no Sai aê)", async () => {
        const uuids: string[] = [];
        for (let i = 0; i < 2; i++) {
            const t = montar({ saiae: { rascunho: RASCUNHO_OK, pedido: { ok: true, senha: 1, total_centavos: 1400 } }, llm: [PEDIR, chamada("confirmar_pedido")] });
            await t.run(entrada("quero 2"));
            await t.run(entrada("pode"));
            uuids.push(String(t.chamadasSaiae.find((c) => c.acao === "pedido")?.corpo?.client_uuid));
        }
        expect(uuids[0]).toBe(uuids[1]);
    });
    it("confirmar_pedido é recusado sem resumo, com texto não afirmativo e depois de outro assunto", async () => {
        const t = montar({ saiae: { rascunho: RASCUNHO_OK, pedido: { ok: true, senha: 1, total_centavos: 1 } }, llm: [chamada("confirmar_pedido"), fala("Preciso montar o pedido antes.")] });
        await t.run(entrada("sim"));
        expect(t.chamadasSaiae.some((c) => c.acao === "pedido")).toBe(false);

        const t2 = montar({ saiae: { rascunho: RASCUNHO_OK, pedido: { ok: true, senha: 1, total_centavos: 1 } }, llm: [PEDIR, chamada("confirmar_pedido"), fala("Ok, o que muda?"), chamada("confirmar_pedido"), fala("Qual o horário?")] });
        await t2.run(entrada("quero 2"));
        await t2.run(entrada("sim mas troca o molho"));
        expect(t2.chamadasSaiae.some((c) => c.acao === "pedido")).toBe(false);
        await t2.run(entrada("sim")); // o resumo deixou de ser o último assunto
        expect(t2.chamadasSaiae.some((c) => c.acao === "pedido")).toBe(false);
    });
    it("Pix: devolve o copia e cola; perfil_obrigatório cai para o link", async () => {
        const t = montar({
            saiae: { rascunho: RASCUNHO_OK, pix: { ok: true, copia_cola: "000201PIX", expira_em: "2026-10-24T16:00:00Z", total_centavos: 1400, pendente_id: "p" } },
            llm: [PEDIR, chamada("confirmar_pedido")],
        });
        await t.run(entrada("quero 2"));
        await t.run(entrada("pix"));
        expect(t.paraCliente().at(-1)).toBe("000201PIX");
        expect(t.chamadasSaiae.find((c) => c.acao === "pix")?.corpo).toMatchObject({ tipo_atendimento: "retirada", conversa_id: expect.any(String) });

        const f = montar({ saiae: { rascunho: RASCUNHO_OK, pix: { ok: false, codigo: "perfil_obrigatorio" } }, llm: [PEDIR, chamada("confirmar_pedido")] });
        await f.run(entrada("quero 2"));
        await f.run(entrada("pix"));
        expect(f.paraCliente().at(-1)).toContain(LINK);
        expect(f.paraCliente().at(-1)).not.toContain("000201");
    });
    it("item inexistente: o erro do resolver vira 'não achei' + link, sem resumo", async () => {
        const t = montar({
            saiae: { rascunho: { ok: false, codigo: "carrinho_invalido", erros: [{ linha: 0, item_id: "x", codigo: "item_inexistente", mensagem: "Item não encontrado" }] } },
            llm: [PEDIR, fala(`Não achei esse item. Veja o cardápio: ${LINK}`)],
        });
        await t.run(entrada("quero uma pizza"));
        expect(t.paraCliente()[0]).toContain("Não achei");
        expect(t.paraCliente()[0]).not.toContain("Total");
        expect(t.estado.conversa(SESSAO, TEL)?.aguardandoConfirmacao).toBe(false);
    });
    it("nunca deixa o modelo falar preço ou link inventado", async () => {
        const t = montar({ llm: [fala("O pastel custa R$ 7,00 hoje")] });
        await t.run(entrada("quanto custa o pastel?"));
        expect(t.paraCliente()[0]).not.toContain("7,00");
        expect(t.paraCliente()[0]).toContain(LINK);
        expect(filtrarTexto("veja https://golpe.com/x", LINK)).toBe(`veja ${LINK}`);
    });
});

describe("bot de pedidos: chamar o dono", () => {
    it("avisa o dono, manda o link ao cliente e pausa a conversa por 12 h", async () => {
        const t = montar({ llm: [chamada("chamar_dono", { motivo: "reclamacao" }), fala("não deveria falar")] });
        await t.run(entrada("o pedido veio errado"));
        const dono = t.enviados.find((x) => x.telefone === "5561988887777");
        expect(dono?.texto).toContain("Ana");
        expect(dono?.texto).toContain("reclamação");
        expect(t.paraCliente()[0]).toContain(LINK);
        await t.run(entrada("alô?"));
        expect(t.paraCliente()).toHaveLength(1);
    });
    it("sem WhatsApp do dono não pausa: só o link", async () => {
        const t = montar({ loja: { whatsapp_dono: null }, llm: [chamada("chamar_dono", { motivo: "duvida" })] });
        await t.run(entrada("tem opção vegana?"));
        expect(t.paraCliente()[0]).toContain(LINK);
        expect(t.estado.pausada(SESSAO, TEL)).toBe(false);
    });
});

describe("bot de pedidos: privacidade nos logs", () => {
    it("nenhum log leva telefone, nome ou texto da mensagem", async () => {
        const t = montar({ saiae: { rascunho: { ok: false, codigo: "x" } }, llm: [PEDIR, fala("x")] });
        (t.deps.enviar as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("falhou 5561999990001"));
        await t.run(entrada("quero pastel segredo-do-cliente"));
        const logs = JSON.stringify([...t.logger.info.mock.calls, ...t.logger.warn.mock.calls]);
        expect(logs).not.toContain(TEL);
        expect(logs).not.toContain("Ana");
        expect(logs).not.toContain("segredo-do-cliente");
    });
});
