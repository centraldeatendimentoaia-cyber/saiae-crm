import { paramJid, paramSessionId } from "../parametros";

export const pathsContatosPerfil = {
    "/profile/{sessionId}": {
        get: {
            tags: ["Profile"],
            summary: "Obter o próprio perfil",
            description: "Obtém as informações de perfil da conta de WhatsApp conectada",
            parameters: [
                paramSessionId
            ],
            responses: {
                200: {
                    description: "Informações do perfil",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean" },
                                    jid: { type: "string" },
                                    status: { type: "object" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" }
            }
        }
    },
    "/profile/{sessionId}/name": {
        put: {
            tags: ["Profile"],
            summary: "Atualizar o nome do perfil",
            description: "Atualiza o nome de exibição do WhatsApp (até 25 caracteres)",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["name"],
                            properties: {
                                name: { type: "string", maxLength: 25 }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Nome atualizado", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" }
            }
        }
    },
    "/profile/{sessionId}/status": {
        put: {
            tags: ["Profile"],
            summary: "Atualizar o recado do perfil",
            description: "Atualiza o recado (Info) do WhatsApp (até 139 caracteres)",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["status"],
                            properties: {
                                status: { type: "string", maxLength: 139 }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Recado atualizado", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" }
            }
        }
    },
    "/profile/{sessionId}/picture": {
        put: {
            tags: ["Profile"],
            summary: "Atualizar a foto do perfil",
            description: "Envia uma nova foto de perfil",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "multipart/form-data": {
                        schema: {
                            type: "object",
                            required: ["file"],
                            properties: {
                                file: { type: "string", format: "binary" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Foto atualizada", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" }
            }
        },
        delete: {
            tags: ["Profile"],
            summary: "Remover a foto do perfil",
            parameters: [
                paramSessionId
            ],
            responses: {
                200: { description: "Foto removida", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" }
            }
        }
    },
    "/contacts/{sessionId}/{jid}/block": {
        post: {
            tags: ["Contacts"],
            summary: "Bloquear contato",
            parameters: [
                paramSessionId,
                paramJid
            ],
            responses: {
                200: { description: "Contato bloqueado", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                500: { description: "Falha ao bloquear o contato" }
            }
        }
    },
    "/contacts/{sessionId}/{jid}/unblock": {
        post: {
            tags: ["Contacts"],
            summary: "Desbloquear contato",
            parameters: [
                paramSessionId,
                paramJid
            ],
            responses: {
                200: { description: "Contato desbloqueado", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                500: { description: "Falha ao desbloquear o contato" }
            }
        }
    },
};
