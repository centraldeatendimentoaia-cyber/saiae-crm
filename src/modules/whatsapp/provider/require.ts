import { NextResponse } from "next/server";
import { getProvider } from "./index";
import type { Capability } from "./types";

const LABELS: Record<Capability, string> = {
    freeTextAnytime: "texto livre a qualquer momento",
    templates: "mensagens de template",
    groups: "grupos",
    polls: "enquetes",
    stickers: "figurinhas",
    lists: "mensagens de lista",
    contacts: "envio de contato",
    locations: "envio de localização",
    reactions: "reações",
    replies: "respostas com citação",
    forwarding: "encaminhamento",
    deleteMessage: "apagar mensagem",
    editMessage: "editar mensagem",
    starMessage: "favoritar mensagem",
    mentions: "menções",
};

/**
 * Para rotas que só existem no Baileys: se a sessão usa um provedor que não suporta o recurso
 * (ex.: a WhatsApp Cloud API oficial), devolve 501 com mensagem clara; senão devolve null e a rota segue.
 * Sessão fora do ar (sem provedor) também devolve null: quem responde 503 é a própria rota.
 */
export function requireCapability(sessionId: string, capability: Capability): NextResponse | null {
    const provider = getProvider(sessionId);
    if (!provider || provider.capabilities[capability]) return null;
    const message = `Este recurso (${LABELS[capability]}) não está disponível em sessões da WhatsApp Cloud API oficial.`;
    return NextResponse.json(
        { status: false, message, error: message, code: "CAPABILITY_NOT_SUPPORTED", capability, provider: provider.name },
        { status: 501 }
    );
}
