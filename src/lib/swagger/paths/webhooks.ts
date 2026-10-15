import { paramId, paramSessionId } from "../parametros";

export const pathsWebhooks = {
    "/webhooks/{sessionId}": {
        get: {
            tags: ["Webhooks"],
            summary: "Listar os webhooks de uma sessão",
            parameters: [
                paramSessionId
            ],
            responses: {
                200: { description: "Lista de webhooks" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" }
            }
        },
        post: {
            tags: ["Webhooks"],
            summary: "Criar um webhook",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["name", "url", "events"],
                            properties: {
                                name: { type: "string" },
                                url: { type: "string" },
                                secret: { type: "string" },
                                events: { type: "array", items: { type: "string" } }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Webhook criado" },
                400: { description: "Dados inválidos" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" }
            }
        }
    },
    "/webhooks/{sessionId}/{id}": {
        put: {
            tags: ["Webhooks"],
            summary: "Atualizar webhook",
            parameters: [
                paramSessionId,
                paramId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                name: { type: "string" },
                                url: { type: "string" },
                                secret: { type: "string" },
                                events: { type: "array", items: { type: "string" } },
                                isActive: { type: "boolean" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Webhook atualizado" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Webhook não encontrado" }
            }
        },
        delete: {
            tags: ["Webhooks"],
            summary: "Apagar webhook",
            parameters: [
                paramSessionId,
                paramId
            ],
            responses: {
                200: { description: "Webhook apagado" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Webhook não encontrado" }
            }
        }
    },
    "/webhooks/{id}": {
        delete: {
            tags: ["Webhooks"],
            summary: "Apagar webhook",
            parameters: [
                paramId
            ],
            responses: {
                200: {
                    description: "Webhook apagado",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                404: { description: "Webhook não encontrado" },
                500: { $ref: "#/components/responses/ServerError" }
            }
        }
    },
    "/webhooks/{sessionId}/{id}/test": {
        post: {
            tags: ["Webhooks"],
            summary: "Testar o endereço do webhook",
            description: "Dispara um envio de teste para verificar se o endereço do webhook está acessível e respondendo corretamente",
            parameters: [
                paramSessionId,
                paramId
            ],
            responses: {
                200: {
                    description: "Resultado do teste",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    status: { type: "boolean" },
                                    message: { type: "string" },
                                    data: {
                                        type: "object",
                                        properties: {
                                            success: { type: "boolean" },
                                            statusCode: { type: "integer" },
                                            responseBody: { type: "string" },
                                            responseTimeMs: { type: "integer" },
                                            error: { type: "string" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Webhook não encontrado" }
            }
        }
    },
    "/webhooks/{sessionId}/{id}/logs": {
        get: {
            tags: ["Webhooks"],
            summary: "Obter o registro de entregas do webhook",
            description: "Obtém o histórico de entregas de um webhook",
            parameters: [
                paramSessionId,
                paramId,
                { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
                { name: "offset", in: "query", schema: { type: "integer", default: 0 } }
            ],
            responses: {
                200: {
                    description: "Registro de entregas do webhook",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    status: { type: "boolean" },
                                    data: {
                                        type: "array",
                                        items: { $ref: "#/components/schemas/WebhookLog" }
                                    },
                                    total: { type: "integer" },
                                    limit: { type: "integer" },
                                    offset: { type: "integer" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Webhook não encontrado" }
            }
        }
    },
};
