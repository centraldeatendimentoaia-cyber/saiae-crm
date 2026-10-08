import { logger } from "@/lib/logger";
import { cloudConfigFromEnv } from "@/modules/whatsapp/cloud/config";
import { CloudApiProvider } from "@/modules/whatsapp/cloud/provider";
import { cloudSessionIds } from "@/modules/whatsapp/provider";
import { registerInboundConsumer } from "@/modules/whatsapp/cloud/inbound-handler";
import { criarConsumidorIa, type IaDeps } from "./consumer";
import { criarControleLimite, prismaConsumo } from "./consumo";
import { criarAvisoLimite, criarChamadorDono, criarLiberador } from "./dono";
import { LlmAnthropic } from "./llm";
import { motorPadrao } from "./motor";
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

export function registrarIaAtendimento(over: Partial<IaDeps> = {}, env: Record<string, string | undefined> = process.env): void {
    const g = globalThis as unknown as { __iaAtendimentoRegistrado?: boolean };
    if (g.__iaAtendimentoRegistrado) return;
    if (env.IA_ATENDIMENTO?.trim().toLowerCase() !== "on") return;
    g.__iaAtendimentoRegistrado = true;

    const enviar = criarEnvioCloud(env) ?? (async () => {
        throw new Error("Cloud API não configurada");
    });
    registerInboundConsumer(criarConsumidorIa({ enviar, responder: criarMotor(env), liberar: criarLiberador({ store: prismaStore }), ...over }));
}
