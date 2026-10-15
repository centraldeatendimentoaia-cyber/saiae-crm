const ROTULOS: Record<string, string> = {
    CONNECTED: "Conectada",
    DISCONNECTED: "Desconectada",
    CONNECTING: "Conectando",
    ZOMBIE: "Sem resposta",
    LOGGED_OUT: "Desconectada pelo WhatsApp",
};

/** Texto em português para o status da sessão (valores do banco ficam em inglês). Desconhecido volta como veio. */
export function rotuloStatusSessao(status: string): string {
    return ROTULOS[status] ?? status;
}
