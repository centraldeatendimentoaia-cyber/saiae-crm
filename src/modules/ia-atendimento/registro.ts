import { cloudConfigFromEnv } from "@/modules/whatsapp/cloud/config";
import { CloudApiProvider } from "@/modules/whatsapp/cloud/provider";
import { cloudSessionIds } from "@/modules/whatsapp/provider";
import { registerInboundConsumer } from "@/modules/whatsapp/cloud/inbound-handler";
import { criarConsumidorIa, type IaDeps } from "./consumer";
import { IaWindowStore } from "./store";

/**
 * Liga a IA ao gancho do webhook da Meta. Só com IA_ATENDIMENTO=on (padrão: desligada: nada é registrado).
 * O envio usa a primeira sessão de WHATSAPP_CLOUD_SESSION_ID e a janela de 24 h lida das mensagens que a
 * própria IA grava (IaWindowStore). Sem credenciais da Cloud API não envia nada (erro registrado sem dados).
 */
export function criarEnvioCloud(env: Record<string, string | undefined> = process.env): IaDeps["enviar"] | null {
    const config = cloudConfigFromEnv(env);
    const sessionId = [...cloudSessionIds(env)][0];
    if (!config || !sessionId) return null;
    const provider = new CloudApiProvider({ sessionId, config, windowStore: new IaWindowStore() });
    return async (contactKey, texto) => (await provider.sendText(contactKey, texto)).messageId;
}

export function registrarIaAtendimento(over: Partial<IaDeps> = {}, env: Record<string, string | undefined> = process.env): void {
    const g = globalThis as unknown as { __iaAtendimentoRegistrado?: boolean };
    if (g.__iaAtendimentoRegistrado) return;
    if (env.IA_ATENDIMENTO?.trim().toLowerCase() !== "on") return;
    g.__iaAtendimentoRegistrado = true;

    const enviar = criarEnvioCloud(env) ?? (async () => {
        throw new Error("Cloud API não configurada");
    });
    registerInboundConsumer(criarConsumidorIa({ enviar, ...over }));
}
