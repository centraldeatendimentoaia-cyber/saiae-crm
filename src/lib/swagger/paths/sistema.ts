import { paramSessionId } from "../parametros";

export const pathsSistema = {
    "/media/{filename}": {
        "get": {
            "tags": [
                "Media"
            ],
            "summary": "Obter um arquivo de mídia enviado",
            "parameters": [
                {
                    "name": "filename",
                    "in": "path",
                    "required": true,
                    "schema": {
                        "type": "string"
                    }
                }
            ],
            "responses": {
                "200": {
                    "description": "Dados do arquivo"
                }
            }
        }
    },
    "/docs": {
        "get": {
            "tags": [
                "Documentation"
            ],
            "summary": "Obter a especificação Swagger em JSON",
            "responses": {
                "200": {
                    "description": "Especificação Swagger em JSON"
                }
            }
        }
    },
    "/settings/system": {
        get: {
            tags: ["System"],
            summary: "Obter as configurações do sistema",
            responses: {
                200: {
                    description: "Configurações do sistema",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    id: { type: "string", example: "default" },
                                    appName: { type: "string", example: "Saiaê" },
                                    logoUrl: { type: "string", example: "https://example.com/logo.png" },
                                    timezone: { type: "string", example: "Asia/Jakarta" }
                                }
                            }
                        }
                    }
                }
            }
        },
        post: {
            tags: ["System"],
            summary: "Atualizar as configurações do sistema",
            description: "Atualiza a configuração global do sistema (somente SUPERADMIN ou dono)",
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                appName: { type: "string" },
                                logoUrl: { type: "string" },
                                timezone: { type: "string" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Configurações atualizadas",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    id: { type: "string" },
                                    appName: { type: "string" },
                                    logoUrl: { type: "string" },
                                    timezone: { type: "string" },
                                    updatedAt: { type: "string", format: "date-time" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                500: { description: "Falha ao atualizar as configurações" }
            }
        }
    },
    "/status/{sessionId}/update": {
        post: {
            tags: ["System"],
            summary: "Publicar status",
            description: "Publica um status (story) no WhatsApp. Aceita texto, imagem e vídeo.",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["content"],
                            properties: {
                                content: { type: "string", description: "Texto ou legenda do status" },
                                type: { type: "string", enum: ["TEXT", "IMAGE", "VIDEO"], default: "TEXT" },
                                mediaUrl: { type: "string", description: "Obrigatório para IMAGE e VIDEO" },
                                backgroundColor: { type: "integer" },
                                font: { type: "integer" },
                                mentions: { type: "array", items: { type: "string" } }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Status publicado", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
                400: { description: "Campos obrigatórios ausentes" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" }
            }
        }
    },
    "/status/update": {
        post: {
            tags: ["System"],
            summary: "Publicar status",
            description: "Publica um status (story) no WhatsApp. Aceita texto, imagem e vídeo.",
            requestBody: {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["sessionId", "content"],
                            properties: {
                                sessionId: { type: "string" },
                                content: { type: "string", description: "Texto ou legenda do status" },
                                type: { type: "string", enum: ["TEXT", "IMAGE", "VIDEO"], default: "TEXT" },
                                mediaUrl: { type: "string", description: "Obrigatório para IMAGE e VIDEO" },
                                backgroundColor: { type: "integer", description: "Cor ARGB do status de texto (TEXT)" },
                                font: { type: "integer", description: "Estilo da fonte do status de texto (TEXT)" },
                                mentions: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Lista de JIDs a mencionar no status"
                                }
                            }
                        },
                        examples: {
                            simple: {
                                summary: "Status de texto simples",
                                value: {
                                    sessionId: "sales-01",
                                    content: "Hello World!",
                                    type: "TEXT",
                                    backgroundColor: 4278190080
                                }
                            },
                            withMention: {
                                summary: "Status com menção",
                                value: {
                                    sessionId: "sales-01",
                                    content: "Check this out @628123456789",
                                    type: "TEXT",
                                    backgroundColor: 4278190080,
                                    mentions: ["628123456789@s.whatsapp.net"]
                                }
                            },
                            image: {
                                summary: "Status com imagem",
                                value: {
                                    sessionId: "sales-01",
                                    content: "Our new product!",
                                    type: "IMAGE",
                                    mediaUrl: "https://example.com/product.jpg"
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Recado atualizado",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" }
                        }
                    }
                },
                400: { description: "Campos obrigatórios ausentes" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { description: "Sessão não está pronta" },
                500: { description: "Falha ao publicar o status" }
            }
        }
    },
    "/system/check-updates": {
        post: {
            tags: ["System"],
            summary: "Verificar atualizações",
            description: "Verifica novas versões no GitHub e cria uma notificação do sistema se houver uma versão mais recente.",
            responses: {
                200: {
                    description: "Resultado da verificação",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean" },
                                    message: { type: "string" },
                                    version: { type: "string", description: "Tag da versão mais recente" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                500: { description: "Erro ao verificar atualizações" }
            }
        }
    },
};
