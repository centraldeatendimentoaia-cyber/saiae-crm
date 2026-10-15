import { paramId } from "../parametros";

export const pathsSessoes = {
    "/sessions": {
        get: {
            tags: ["Sessions"],
            summary: "Listar todas as sessões acessíveis",
            description: "Lista todas as sessões que o usuário autenticado pode acessar (filtradas pelo papel)",
            responses: {
                200: {
                    description: "Lista de sessões",
                    content: {
                        "application/json": {
                            schema: {
                                type: "array",
                                items: { $ref: "#/components/schemas/Session" }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" }
            }
        },
        post: {
            tags: ["Sessions"],
            summary: "Criar uma nova sessão de WhatsApp",
            description: "Cria uma nova sessão de WhatsApp para conectar por QR code",
            requestBody: {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["name"],
                            properties: {
                                name: { type: "string", example: "Sales Bot", description: "Nome de exibição da sessão" },
                                sessionId: { type: "string", example: "sales-01", description: "ID único da sessão (gerado automaticamente se não for informado)" }
                            }
                        },
                        example: {
                            name: "Marketing Bot",
                            sessionId: "marketing-1"
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Sessão criada com sucesso",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Session" }
                        }
                    }
                },
                400: { description: "Corpo da requisição inválido" },
                401: { $ref: "#/components/responses/Unauthorized" }
            }
        }
    },
    "/sessions/{id}/qr": {
        get: {
            tags: ["Sessions"],
            summary: "Obter o QR code para conectar",
            description: "Obtém o QR code (texto e imagem em base64) para conectar o WhatsApp",
            parameters: [
                {
                    name: "id",
                    in: "path",
                    required: true,
                    schema: { type: "string" },
                    description: "ID da sessão",
                    example: "sales-01"
                }
            ],
            responses: {
                200: {
                    description: "QR code gerado",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean" },
                                    qr: { type: "string", description: "Texto do QR code" },
                                    base64: { type: "string", description: "URL de dados em base64 da imagem" }
                                }
                            },
                            example: { status: true, message: "QR code generated", data: { success: true, qr: "2@AbCdEfGhIjKlMnOp...", base64: "data:image/png;base64,iVBORw0KGgo..." } }
                        }
                    }
                },
                400: { description: "Já está conectada" },
                404: { description: "QR code ainda não disponível" }
            }
        }
    },
    "/sessions/{id}/bot-config": {
        get: {
            tags: ["Sessions"],
            summary: "Obter a configuração do bot",
            parameters: [paramId],
            responses: { 200: { description: "Configuração do bot obtida" } }
        },
        post: {
            tags: ["Sessions"],
            summary: "Atualizar a configuração do bot",
            parameters: [paramId],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                enabled: { type: "boolean" },
                                botMode: { type: "string", enum: ["OWNER", "SPECIFIC", "BLACKLIST", "ALL"] },
                                botAllowedJids: { type: "array", items: { type: "string" } },
                                botBlockedJids: { type: "array", items: { type: "string" } },
                                autoReplyMode: { type: "string", enum: ["OWNER", "SPECIFIC", "BLACKLIST", "ALL"] },
                                autoReplyAllowedJids: { type: "array", items: { type: "string" } },
                                autoReplyBlockedJids: { type: "array", items: { type: "string" } },
                                botName: { type: "string" },
                                enableSticker: { type: "boolean" },
                                enableVideoSticker: { type: "boolean" },
                                maxStickerDuration: { type: "integer" },
                                enablePing: { type: "boolean" },
                                enableUptime: { type: "boolean" },
                                removeBgApiKey: { type: "string", nullable: true }
                            }
                        },
                        example: {
                            enabled: true,
                            botMode: "BLACKLIST",
                            botBlockedJids: ["628123456789@s.whatsapp.net"],
                            autoReplyMode: "SPECIFIC",
                            autoReplyAllowedJids: ["628123456789@s.whatsapp.net"],
                            botName: "My Assistant",
                            enableSticker: true
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Configuração atualizada",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    id: { type: "string" },
                                    sessionId: { type: "string" },
                                    enabled: { type: "boolean" },
                                    botMode: { type: "string" },
                                    botAllowedJids: { type: "array", items: { type: "string" } },
                                    autoReplyMode: { type: "string" },
                                    autoReplyAllowedJids: { type: "array", items: { type: "string" } },
                                    botName: { type: "string" },
                                    enableSticker: { type: "boolean" },
                                    enableVideoSticker: { type: "boolean" },
                                    maxStickerDuration: { type: "integer" },
                                    enablePing: { type: "boolean" },
                                    enableUptime: { type: "boolean" },
                                    removeBgApiKey: { type: "string", nullable: true },
                                    createdAt: { type: "string", format: "date-time" },
                                    updatedAt: { type: "string", format: "date-time" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Sessão não encontrada" },
                500: { description: "Erro interno do servidor" }
            }
        }
    },
    "/sessions/{id}": {
        get: {
            tags: ["Sessions"],
            summary: "Obter os detalhes da sessão",
            description: "Obtém informações detalhadas de uma sessão, incluindo tempo ativo e status",
            parameters: [
                paramId
            ],
            responses: {
                200: {
                    description: "Detalhes da sessão",
                    content: {
                        "application/json": {
                            schema: {
                                allOf: [
                                    { $ref: "#/components/schemas/Session" },
                                    {
                                        type: "object",
                                        properties: {
                                            uptime: { type: "integer", description: "Tempo ativo em segundos" },
                                            messageCount: { type: "integer" },
                                            hasInstance: { type: "boolean" },
                                            me: { type: "object", nullable: true }
                                        }
                                    }
                                ]
                            }
                        }
                    }
                },
                404: { description: "Sessão não encontrada" }
            }
        }
    },
    "/sessions/{id}/{action}": {
        post: {
            tags: ["Sessions"],
            summary: "Executar uma ação na sessão",
            description: "Inicia, para, reinicia ou desconecta uma sessão",
            parameters: [
                paramId,
                { name: "action", in: "path", required: true, schema: { type: "string", enum: ["start", "stop", "restart", "logout"] } }
            ],
            responses: {
                200: {
                    description: "Ação executada com sucesso",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" }
                        }
                    }
                },
                400: { description: "Ação inválida" },
                500: { description: "A ação falhou" }
            }
        }
    },
    "/sessions/{id}/settings": {
        patch: {
            tags: ["Sessions"],
            summary: "Atualizar as configurações da sessão",
            parameters: [paramId],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                config: {
                                    type: "object",
                                    properties: {
                                        readReceipts: { type: "boolean" },
                                        rejectCalls: { type: "boolean" }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            responses: { 200: { description: "Configurações atualizadas" } }
        },
        delete: {
            tags: ["Sessions"],
            summary: "Excluir a sessão e desconectar",
            description: "Exclui a sessão de forma permanente e desconecta do WhatsApp",
            parameters: [paramId],
            responses: {
                200: {
                    description: "Sessão excluída",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" }
                        }
                    }
                }
            }
        }
    },
    "/sessions/{sessionId}/access": {
        get: {
            tags: ["Session Access"],
            summary: "Listar usuários com acesso compartilhado",
            description: "Lista todos os usuários com acesso à sessão informada. Só o dono da sessão ou um SUPERADMIN pode usar esta rota.",
            parameters: [
                { name: "sessionId", in: "path", required: true, schema: { type: "string" }, description: "ID da sessão (slug ou CUID)", example: "marketing-1" }
            ],
            responses: {
                200: {
                    description: "Lista de acessos obtida",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    status: { type: "boolean", example: true },
                                    message: { type: "string", example: "Access list retrieved successfully" },
                                    data: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                id: { type: "string" },
                                                sessionId: { type: "string" },
                                                userId: { type: "string" },
                                                createdAt: { type: "string", format: "date-time" },
                                                user: {
                                                    type: "object",
                                                    properties: {
                                                        id: { type: "string" },
                                                        name: { type: "string" },
                                                        email: { type: "string" },
                                                        role: { type: "string" }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { description: "Proibido: só o dono da sessão pode gerenciar acessos" },
                404: { description: "Sessão não encontrada" }
            }
        },
        post: {
            tags: ["Session Access"],
            summary: "Conceder acesso a outro usuário",
            description: "Concede acesso à sessão a outro usuário cadastrado, pelo e-mail. Só o dono da sessão ou um SUPERADMIN pode usar esta rota. Não é possível conceder acesso ao dono da sessão nem a SUPERADMINs.",
            parameters: [
                { name: "sessionId", in: "path", required: true, schema: { type: "string" }, description: "ID da sessão (slug ou CUID)", example: "marketing-1" }
            ],
            requestBody: {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["email"],
                            properties: {
                                email: { type: "string", format: "email", description: "E-mail do usuário que receberá o acesso", example: "staff@example.com" }
                            }
                        }
                    }
                }
            },
            responses: {
                201: {
                    description: "Acesso concedido com sucesso",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    status: { type: "boolean", example: true },
                                    message: { type: "string", example: "Access granted to staff@example.com" },
                                    data: {
                                        type: "object",
                                        properties: {
                                            id: { type: "string" },
                                            sessionId: { type: "string" },
                                            userId: { type: "string" },
                                            createdAt: { type: "string", format: "date-time" },
                                            user: {
                                                type: "object",
                                                properties: {
                                                    id: { type: "string" },
                                                    name: { type: "string" },
                                                    email: { type: "string" },
                                                    role: { type: "string" }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                400: { description: "Erro de validação, ou não é possível conceder ao dono, ou o SUPERADMIN já tem acesso" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { description: "Proibido: só o dono da sessão pode gerenciar acessos" },
                404: { description: "Sessão ou usuário não encontrado" },
                409: { description: "O usuário já tem acesso a esta sessão" }
            }
        },
        delete: {
            tags: ["Session Access"],
            summary: "Revogar o acesso de um usuário",
            description: "Remove o acesso compartilhado de um usuário à sessão informada. Só o dono da sessão ou um SUPERADMIN pode usar esta rota.",
            parameters: [
                { name: "sessionId", in: "path", required: true, schema: { type: "string" }, description: "ID da sessão (slug ou CUID)", example: "marketing-1" }
            ],
            requestBody: {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["userId"],
                            properties: {
                                userId: { type: "string", description: "CUID do usuário que perderá o acesso", example: "clx456ghi" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Acesso revogado com sucesso",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" }
                        }
                    }
                },
                400: { description: "Erro de validação" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { description: "Proibido: só o dono da sessão pode gerenciar acessos" },
                404: { description: "Sessão ou registro de acesso não encontrado" }
            }
        }
    },
};
