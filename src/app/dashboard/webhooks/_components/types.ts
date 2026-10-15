export interface WebhookConfig {
    id: string;
    name: string;
    url: string;
    secret?: string;
    sessionId?: string;
    events: string[];
    isActive: boolean;
    createdAt: string;
}

export interface WebhookTestResult {
    testing?: boolean;
    success?: boolean;
    error?: string;
    statusCode?: number;
    responseTimeMs?: number;
    responseBody?: string;
}

export const AVAILABLE_EVENTS = [
    { id: "message.received", label: "Mensagem recebida", description: "Quando uma nova mensagem é recebida" },
    { id: "message.sent", label: "Mensagem enviada", description: "Quando uma mensagem é enviada" },
    { id: "message.status", label: "Status da mensagem", description: "Quando o status da mensagem muda (entregue, lida)" },
    { id: "connection.update", label: "Atualização de conexão", description: "Quando a sessão conecta/desconecta" },
    { id: "group.update", label: "Atualização de grupo", description: "Quando as informações do grupo mudam" },
    { id: "group.participant", label: "Membro do grupo", description: "Quando participantes entram, saem ou mudam de função" },
    { id: "contact.update", label: "Atualização de contato", description: "Quando as informações do contato mudam" },
    { id: "status.update", label: "Status/Story", description: "Quando um status é publicado ou visualizado" },
    { id: "message.edited", label: "Mensagem editada", description: "Quando uma mensagem é editada" },
    { id: "message.deleted", label: "Mensagem apagada", description: "Quando uma mensagem é revogada/apagada" },
];

export const DEFAULT_NEW_EVENTS = ["message.received", "message.sent"];
