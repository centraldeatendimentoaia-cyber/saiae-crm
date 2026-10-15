import { paramJid, paramLabelId, paramSessionId } from "../parametros";

export const pathsEtiquetas = {
    "/labels/{sessionId}": {
        "put": {
            "tags": [
                "Labels"
            ],
            "summary": "Atualizar todas as etiquetas (em massa)",
            "parameters": [
                {
                    "name": "sessionId",
                    "in": "path",
                    "required": true,
                    "schema": {
                        "type": "string"
                    }
                }
            ],
            "responses": {
                "200": {
                    "description": "Etiquetas atualizadas"
                }
            }
        },
        "delete": {
            "tags": [
                "Labels"
            ],
            "summary": "Apagar etiquetas",
            "parameters": [
                {
                    "name": "sessionId",
                    "in": "path",
                    "required": true,
                    "schema": {
                        "type": "string"
                    }
                }
            ],
            "responses": {
                "200": {
                    "description": "Etiquetas apagadas"
                }
            }
        },
        get: {
            tags: ["Labels"],
            summary: "Listar etiquetas",
            description: "Obtém todas as etiquetas, com a quantidade de conversas",
            parameters: [
                paramSessionId
            ],
            responses: {
                200: {
                    description: "Lista de etiquetas",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    labels: { type: "array", items: { $ref: "#/components/schemas/Label" } }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Sessão não encontrada" }
            }
        },
        post: {
            tags: ["Labels"],
            summary: "Criar etiqueta",
            description: "Cria uma nova etiqueta com cor (índice de 0 a 19)",
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
                                name: { type: "string", example: "Important" },
                                color: { type: "integer", minimum: 0, maximum: 19, example: 0, description: "Índice da cor (0 a 19)" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Etiqueta criada",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    label: { $ref: "#/components/schemas/Label" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                500: { description: "Falha ao criar a etiqueta" }
            }
        }
    },
    "/labels/{sessionId}/{labelId}": {
        put: {
            tags: ["Labels"],
            summary: "Atualizar etiqueta",
            parameters: [
                paramSessionId,
                paramLabelId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                name: { type: "string" },
                                color: { type: "integer", minimum: 0, maximum: 19 }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Etiqueta atualizada",
                    content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, label: { $ref: "#/components/schemas/Label" } } } } }
                }
            }
        },
        delete: {
            tags: ["Labels"],
            summary: "Apagar etiqueta",
            parameters: [
                paramSessionId,
                paramLabelId
            ],
            responses: {
                200: {
                    description: "Etiqueta apagada",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } }
                }
            }
        }
    },
    "/labels/{sessionId}/chat/{jid}/labels": {
        get: {
            tags: ["Labels"],
            summary: "Obter as etiquetas da conversa",
            parameters: [
                paramSessionId,
                paramJid
            ],
            responses: {
                200: {
                    description: "Etiquetas da conversa",
                    content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, labels: { type: "array", items: { $ref: "#/components/schemas/Label" } } } } } }
                }
            }
        },
        put: {
            tags: ["Labels"],
            summary: "Atualizar as etiquetas da conversa",
            parameters: [
                paramSessionId,
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["labelIds", "action"],
                            properties: {
                                labelIds: { type: "array", items: { type: "string" } },
                                action: { type: "string", enum: ["add", "remove"] }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Etiquetas da conversa atualizadas",
                    content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, message: { type: "string" }, labels: { type: "array", items: { $ref: "#/components/schemas/Label" } } } } } }
                }
            }
        }
    },
};
