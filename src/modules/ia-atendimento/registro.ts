import { logger } from "@/lib/logger";
import { cloudConfigFromEnv } from "@/modules/whatsapp/cloud/config";
import { CloudApiProvider } from "@/modules/whatsapp/cloud/provider";
import { cloudSessionIds } from "@/modules/whatsapp/provider";
import { registerInboundConsumer } from "@/modules/whatsapp/cloud/inbound-handler";
import { criarConsumidorIa, type IaDeps } from "./consumer";
import { criarConfirmador } from "./confirmar-dono";
import { criarControleLimite, maxRespostasDia, prismaConsumo } from "./consumo";
import { criarAvisoLimite, criarChamadorDono, criarLiberador } from "./dono";
import { LlmAnthropic } from "./llm";
import { motorPadrao } from "./motor";
import { criarControleVendas, criarResponderVendas } from "./vendas/motor";
import type { MotivoHumano } from "./vendas/ferramentas";
import { VENDAS } from "./store";
import type { MotivoDono } from "./ferramentas";
import type { IaContextoAtivo } from "./comanda-contexto";
import { IaWindowStore, prismaStore } from "./store";

/**
 * Liga a IA ao gancho do webhook da Meta. Só com IA_ATENDIMENTO=on (padrão: desligada: nada é registrado).
 * O envio usa a primeira sessão de WHATSAPP_CLOUD_SESSION_ID e a janela de 24 h lida das mensagens que a
 * própria IA grava (IaWindowStore). Sem credenciais da Cloud API não envia nada (erro registrado sem dados).
 */
export function criarProviderCloud(env: Record<string, string | undefined> = process.env): CloudApiProvider | null {
    const config = cloudConfigFromEnv(env);
    const sessionId = [...cloudSessionIds(env)][0];
    if (!config || !sessionId) return null;
    return new CloudApiProvider({ sessionId, config, windowStore: new IaWindowStore() });
}

export function criarEnvioCloud(env: Record<string, string | undefined> = process.env): IaDeps["enviar"] | null {
    const provider = criarProviderCloud(env);
    if (!provider) return null;
    return async (contactKey, texto) => (await provider.sendText(contactKey, texto)).messageId;
}

/**
 * Motor da IA (modelo + aviso ao responsável). Sem IA_MODELO ou ANTHROPIC_API_KEY, ou sem Cloud API, a IA não responde:
 * o consumidor só registra as mensagens. Ambas as variáveis só existem no Railway, definidas pelo dono.
 */
export function criarMotor(env: Record<string, string | undefined> = process.env): IaDeps["responder"] | undefined {
    if (!env.IA_MODELO?.trim() || !env.ANTHROPIC_API_KEY?.trim()) {
        logger.warn("IaAtendimento", "IA_MODELO ou ANTHROPIC_API_KEY ausente: a IA não vai responder");
        return undefined;
    }
    const provider = criarProviderCloud(env);
    if (!provider?.sendTemplate) {
        logger.warn("IaAtendimento", "Cloud API não configurada: a IA não vai responder");
        return undefined;
    }
    const chamarDono = criarChamadorDono({ enviarTemplate: (to, t) => provider.sendTemplate!(to, t), store: prismaStore, contar: prismaConsumo.incrementar });
    const limite = criarControleLimite({ store: prismaConsumo, avisarDono: criarAvisoLimite((to, t) => provider.sendTemplate!(to, t)) });
    return motorPadrao(
        new LlmAnthropic({ env }),
        prismaStore,
        (conversa, ctx) => ({
            chamarDono: (motivo) => chamarDono(conversa, ctx, motivo),
            // sem tabela própria na fase 1: só conta no log (nunca o texto da pergunta)
            registrarPergunta: async () => logger.info("IaAtendimento", "pergunta sem resposta registrada"),
        }),
        limite,
    );
}

const MOTIVO_HUMANO_PARA_DONO: Record<MotivoHumano, MotivoDono> = {
    pedido_humano: "pedido_humano",
    reclamacao: "reclamacao",
    fora_do_conhecimento: "nao_sei",
    negociacao: "pedido_humano",
};

/**
 * Atendente de vendas do Saiaê (IA_VENDAS=on, além de IA_ATENDIMENTO=on): atende quem chega sem código de loja. Precisa de
 * IA_MODELO, ANTHROPIC_API_KEY e Cloud API como a IA das lojas; IA_VENDAS_WHATSAPP_RESPONSAVEL (a equipe do Saiaê, que
 * recebe o aviso e pode mandar "LIBERAR #VENDAS") e IA_VENDAS_LINK_CADASTRO (o único link que ela pode mandar).
 */
export function criarMotorVendas(env: Record<string, string | undefined> = process.env): IaDeps["vendas"] | undefined {
    if (env.IA_VENDAS?.trim().toLowerCase() !== "on") return undefined;
    if (!env.IA_MODELO?.trim() || !env.ANTHROPIC_API_KEY?.trim()) {
        logger.warn("IaVendas", "IA_MODELO ou ANTHROPIC_API_KEY ausente: a atendente de vendas não vai responder");
        return undefined;
    }
    const provider = criarProviderCloud(env);
    if (!provider?.sendTemplate) {
        logger.warn("IaVendas", "Cloud API não configurada: a atendente de vendas não vai responder");
        return undefined;
    }
    const enviarTemplate: Parameters<typeof criarChamadorDono>[0]["enviarTemplate"] = (to, t) => provider.sendTemplate!(to, t);
    const link = env.IA_VENDAS_LINK_CADASTRO?.trim() ?? "";
    const linkCadastro = /^https:\/\/\S+$/i.test(link) ? link : null;
    if (!linkCadastro) logger.warn("IaVendas", "IA_VENDAS_LINK_CADASTRO ausente ou fora de https: a atendente não terá o que enviar");
    const equipe = { loja: { nome: "Saiaê vendas" }, ia: { whatsapp_dono: env.IA_VENDAS_WHATSAPP_RESPONSAVEL ?? null } } as unknown as IaContextoAtivo;
    const chamarDono = criarChamadorDono({ enviarTemplate, store: prismaStore, contar: prismaConsumo.incrementar });
    const limite = criarControleVendas({
        store: prismaConsumo,
        env,
        now: () => new Date(),
        maxGlobal: maxRespostasDia,
        avisar: (motivo) =>
            criarAvisoLimite(enviarTemplate)(equipe, motivo === "global" ? "global" : "plano").then(() => undefined),
        logger,
    });
    return criarResponderVendas({
        llm: new LlmAnthropic({ env }),
        store: prismaStore,
        linkCadastro,
        chamarHumano: (conversa, motivo) => chamarDono({ ...conversa, lojaCodigo: VENDAS }, equipe, MOTIVO_HUMANO_PARA_DONO[motivo]),
        limite,
        now: () => new Date(),
        logger,
    });
}

/** Mensagens do responsável: "LIBERAR #CODIGO" ou "CONFIRMAR #CODIGO" (as duas só valem do WhatsApp cadastrado da loja). */
export function criarLiberadorOuConfirmador(): NonNullable<IaDeps["liberar"]> {
    const liberar = criarLiberador({ store: prismaStore });
    const confirmar = criarConfirmador();
    return async (texto, contactKey) => (await liberar(texto, contactKey)) ?? (await confirmar(texto, contactKey));
}

export function registrarIaAtendimento(over: Partial<IaDeps> = {}, env: Record<string, string | undefined> = process.env): void {
    const g = globalThis as unknown as { __iaAtendimentoRegistrado?: boolean };
    if (g.__iaAtendimentoRegistrado) return;
    if (env.IA_ATENDIMENTO?.trim().toLowerCase() !== "on") return;
    g.__iaAtendimentoRegistrado = true;

    const enviar = criarEnvioCloud(env) ?? (async () => {
        throw new Error("Cloud API não configurada");
    });
    registerInboundConsumer(criarConsumidorIa({ enviar, responder: criarMotor(env), vendas: criarMotorVendas(env), liberar: criarLiberadorOuConfirmador(), ...over }));
}
