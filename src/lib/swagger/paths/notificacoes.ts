export const pathsNotificacoes = {
    "/notifications": {
        get: {
            tags: ["Notifications"],
            summary: "Listar notificações",
            description: "Obtém as últimas 50 notificações do usuário autenticado",
            responses: {
                200: {
                    description: "Lista de notificações",
                    content: {
                        "application/json": {
                            schema: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        id: { type: "string" },
                                        userId: { type: "string" },
                                        title: { type: "string" },
                                        message: { type: "string" },
                                        type: { type: "string" },
                                        href: { type: "string", nullable: true },
                                        read: { type: "boolean" },
                                        createdAt: { type: "string", format: "date-time" }
                                    }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                500: { description: "Erro ao buscar as notificações" }
            }
        },
        post: {
            tags: ["Notifications"],
            summary: "Criar notificação",
            description: "Envia uma notificação a um usuário específico ou a todos (somente SUPERADMIN)",
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["title", "message"],
                            properties: {
                                title: { type: "string", example: "Maintenance" },
                                message: { type: "string", example: "System update in 5 minutes" },
                                type: { type: "string", enum: ["INFO", "SUCCESS", "WARNING", "ERROR"], default: "INFO" },
                                href: { type: "string", example: "/settings" },
                                targetUserId: { type: "string", description: "UUID do usuário de destino" },
                                broadcast: { type: "boolean", default: false }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Notificação criada",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    count: { type: "integer", description: "Quantidade de usuários notificados, no envio para todos" }
                                }
                            }
                        }
                    }
                },
                400: { description: "Requisição inválida" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                500: { description: "Erro ao criar a notificação" }
            }
        }
    },
    "/notifications/read": {
        patch: {
            tags: ["Notifications"],
            summary: "Marcar notificações como lidas",
            description: "Marca notificações específicas, ou todas, como lidas para o usuário autenticado",
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                ids: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Lista de IDs de notificações. Se for omitida ou vazia, todas as notificações são marcadas como lidas."
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Notificações atualizadas",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                500: { description: "Erro ao atualizar as notificações" }
            }
        }
    },
    "/notifications/delete": {
        delete: {
            tags: ["Notifications"],
            summary: "Apagar uma notificação",
            parameters: [
                {
                    name: "id",
                    in: "query",
                    required: true,
                    schema: { type: "string" },
                    description: "UUID da notificação"
                }
            ],
            responses: {
                200: {
                    description: "Notificação apagada",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" }
                        }
                    }
                },
                400: { description: "O ID da notificação é obrigatório" },
                401: { $ref: "#/components/responses/Unauthorized" },
                500: { description: "Erro ao apagar a notificação" }
            }
        }
    },
};
