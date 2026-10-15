import { paramLabelId, paramSessionId } from "../parametros";

export const pathsConversas = {
    "/chats/by-label/{labelId}": {
        "get": {
            "tags": [
                "Chats"
            ],
            "summary": "Obter conversas pelo ID da etiqueta",
            "parameters": [
                {
                    "name": "labelId",
                    "in": "path",
                    "required": true,
                    "schema": {
                        "type": "string"
                    }
                }
            ],
            "responses": {
                "200": {
                    "description": "Lista de conversas com a etiqueta"
                }
            }
        }
    },
    "/chat/{sessionId}": {
        get: {
            tags: ["Chat"],
            summary: "Obter a lista de conversas com contatos",
            description: "Obtém todos os contatos de uma sessão, com a última mensagem",
            parameters: [
                paramSessionId
            ],
            responses: {
                200: {
                    description: "Lista de conversas",
                    content: {
                        "application/json": {
                            schema: {
                                type: "array",
                                items: { $ref: "#/components/schemas/Contact" }
                            }
                        }
                    }
                }
            }
        }
    },
    "/chat/{sessionId}/{jid}": {
        get: {
            tags: ["Chat"],
            summary: "Obter o histórico de mensagens",
            description: "Busca até 100 mensagens de uma conversa (com dados dos participantes em grupos)",
            parameters: [
                paramSessionId,
                { name: "jid", in: "path", required: true, schema: { type: "string" }, description: "JID codificado para URL" }
            ],
            responses: { 200: { description: "Histórico de mensagens (no máximo 100)" } }
        }
    },
    "/chat/{sessionId}/{jid}/read": {
        put: {
            tags: ["Chat"],
            summary: "Marcar mensagens como lidas",
            description: "Marca mensagens específicas, ou a conversa inteira, como lidas, usando parâmetros no caminho",
            parameters: [
                { name: "sessionId", in: "path", required: true, schema: { type: "string" }, description: "Identificador da sessão" },
                { name: "jid", in: "path", required: true, schema: { type: "string" }, description: "JID do WhatsApp codificado para URL" }
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                messageIds: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Opcional: IDs das mensagens a marcar como lidas. Se não for informado, marca a conversa inteira"
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Mensagens marcadas como lidas",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "Messages marked as read" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao marcar as mensagens como lidas" }
            }
        }
    },
    "/chat/{sessionId}/{jid}/archive": {
        put: {
            tags: ["Chat"],
            summary: "Arquivar ou desarquivar conversa",
            description: "Arquiva ou desarquiva uma conversa, usando parâmetros no caminho",
            parameters: [
                paramSessionId,
                { name: "jid", in: "path", required: true, schema: { type: "string" }, description: "JID codificado para URL" }
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["archive"],
                            properties: {
                                archive: { type: "boolean", description: "true para arquivar, false para desarquivar" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Conversa arquivada ou desarquivada",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "Chat archived" }
                                }
                            }
                        }
                    }
                },
                400: { description: "Campos obrigatórios ausentes" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao arquivar ou desarquivar a conversa" }
            }
        }
    },
    "/chat/{sessionId}/{jid}/mute": {
        put: {
            tags: ["Chat"],
            summary: "Silenciar ou reativar conversa",
            description: "Silencia a conversa, com duração opcional (padrão: 8 horas)",
            parameters: [
                paramSessionId,
                { name: "jid", in: "path", required: true, schema: { type: "string" }, description: "JID codificado para URL" }
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["mute"],
                            properties: {
                                mute: { type: "boolean" },
                                duration: { type: "integer", description: "Duração em segundos (padrão: 8 horas)", example: 3600 }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Conversa silenciada ou reativada",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "Chat muted" }
                                }
                            }
                        }
                    }
                },
                400: { description: "Campos obrigatórios ausentes" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao silenciar ou reativar a conversa" }
            }
        }
    },
    "/chat/{sessionId}/{jid}/pin": {
        put: {
            tags: ["Chat"],
            summary: "Fixar ou desafixar conversa",
            description: "Fixa ou desafixa uma conversa",
            parameters: [
                paramSessionId,
                { name: "jid", in: "path", required: true, schema: { type: "string" }, description: "JID codificado para URL" }
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["pin"],
                            properties: {
                                pin: { type: "boolean" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Conversa fixada ou desafixada",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "Chat pinned" }
                                }
                            }
                        }
                    }
                },
                400: { description: "Campos obrigatórios ausentes" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao fixar ou desafixar a conversa" }
            }
        }
    },
    "/chat/{sessionId}/{jid}/presence": {
        post: {
            tags: ["Chat"],
            summary: "Enviar presença (digitando ou gravando)",
            description: "Envia o status de presença (digitando, gravando, online etc.) a uma conversa",
            parameters: [
                paramSessionId,
                { name: "jid", in: "path", required: true, schema: { type: "string" }, description: "JID codificado para URL" }
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["presence"],
                            properties: {
                                presence: {
                                    type: "string",
                                    enum: ["composing", "recording", "paused", "available", "unavailable"],
                                    example: "composing"
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Presença enviada",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "Presence 'composing' sent to 628123456789@s.whatsapp.net" }
                                }
                            }
                        }
                    }
                },
                400: { description: "Campos obrigatórios ausentes ou presença inválida" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao enviar a presença" }
            }
        }
    },
    "/chat/{sessionId}/{jid}/profile-picture": {
        post: {
            tags: ["Chat"],
            summary: "Obter a URL da foto de perfil",
            description: "Obtém a URL da foto de perfil de um contato ou grupo",
            parameters: [
                paramSessionId,
                { name: "jid", in: "path", required: true, schema: { type: "string" }, description: "JID codificado para URL" }
            ],
            responses: {
                200: {
                    description: "URL da foto de perfil",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    jid: { type: "string", example: "628123456789@s.whatsapp.net" },
                                    profilePicUrl: { type: "string", nullable: true, example: "https://pps.whatsapp.net/..." },
                                    message: { type: "string", example: "No profile picture found" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao buscar a foto de perfil" }
            }
        }
    },
    "/chat/{sessionId}/check": {
        post: {
            tags: ["Chat"],
            summary: "Verificar se os números existem no WhatsApp",
            description: "Valida números de telefone (no máximo 50 por requisição)",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["numbers"],
                            properties: {
                                numbers: {
                                    type: "array",
                                    items: { type: "string" },
                                    maxItems: 50,
                                    example: ["628123456789", "628987654321"]
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Resultados da validação",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean" },
                                    results: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                number: { type: "string" },
                                                exists: { type: "boolean" },
                                                jid: { type: "string", nullable: true },
                                                error: { type: "string", nullable: true }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                400: { description: "Campos obrigatórios ausentes" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao verificar os números" }
            }
        }
    },
    "/chats/{sessionId}/by-label/{labelId}": {
        get: {
            tags: ["Labels"],
            summary: "Obter conversas por etiqueta",
            description: "Obtém todas as conversas associadas a uma etiqueta",
            parameters: [
                paramSessionId,
                paramLabelId
            ],
            responses: {
                200: {
                    description: "Lista de conversas com a etiqueta",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean" },
                                    label: { type: "object" },
                                    chats: { type: "array", items: { type: "string" } },
                                    count: { type: "integer" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Etiqueta não encontrada" }
            }
        }
    },
};
