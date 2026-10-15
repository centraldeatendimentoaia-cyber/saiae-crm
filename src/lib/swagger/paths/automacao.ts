import { paramSessionId } from "../parametros";

export const pathsAutomacao = {
    "/autoreplies/{sessionId}": {
        "delete": {
            "tags": [
                "Auto Replies"
            ],
            "summary": "Apagar todas as respostas automáticas",
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
                    "description": "Respostas automáticas apagadas"
                }
            }
        },
        get: {
            tags: ["Auto Reply"],
            summary: "Listar regras de resposta automática",
            parameters: [
                paramSessionId
            ],
            responses: {
                200: { description: "Lista de regras de resposta automática" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Sessão não encontrada" }
            }
        },
        post: {
            tags: ["Auto Reply"],
            summary: "Criar regra de resposta automática",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["keyword"],
                            properties: {
                                keyword: { type: "string" },
                                response: { type: "string" },
                                matchType: { type: "string", enum: ["EXACT", "CONTAINS", "STARTS_WITH", "REGEX"] },
                                isMedia: { type: "boolean" },
                                mediaUrl: { type: "string" },
                                mediaType: { type: "string", enum: ["image", "video", "document", "audio"] },
                                triggerType: { type: "string", enum: ["ALL", "GROUP", "PRIVATE"] }
                            }
                        },
                        example: {
                            keyword: "hello",
                            response: "Hi there! How can I help?",
                            matchType: "EXACT",
                            triggerType: "ALL",
                            isMedia: false,
                            mediaUrl: null,
                            mediaType: null
                        }
                    }
                }
            },
            responses: {
                200: { description: "Regra criada" },
                400: { description: "Campos obrigatórios ausentes" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" }
            }
        }
    },
    "/autoreplies/{sessionId}/{replyId}": {
        put: {
            tags: ["Auto Reply"],
            summary: "Atualizar regra de resposta automática",
            parameters: [
                paramSessionId,
                { name: "replyId", in: "path", required: true, schema: { type: "string" } }
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["keyword"],
                            properties: {
                                keyword: { type: "string" },
                                response: { type: "string" },
                                isMedia: { type: "boolean" },
                                mediaUrl: { type: "string" },
                                mediaType: { type: "string", enum: ["image", "video", "document", "audio"] },
                                triggerType: { type: "string", enum: ["ALL", "GROUP", "PRIVATE"] }
                            }
                        },
                        example: {
                            keyword: "hello",
                            response: "Hi there! How can I help?",
                            matchType: "EXACT",
                            triggerType: "ALL",
                            isMedia: false,
                            mediaUrl: null,
                            mediaType: null
                        }
                    }
                }
            },
            responses: {
                200: { description: "Regra atualizada" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Regra não encontrada" }
            }
        },
        delete: {
            tags: ["Auto Reply"],
            summary: "Apagar regra de resposta automática",
            parameters: [
                paramSessionId,
                { name: "replyId", in: "path", required: true, schema: { type: "string" } }
            ],
            responses: {
                200: { description: "Regra apagada" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Regra não encontrada" }
            }
        }
    },
    "/scheduler/{sessionId}": {
        "delete": {
            "tags": [
                "Scheduler"
            ],
            "summary": "Apagar todas as mensagens agendadas de uma sessão",
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
                    "description": "Mensagens agendadas apagadas"
                }
            }
        },
        get: {
            tags: ["Scheduler"],
            summary: "Listar mensagens agendadas",
            parameters: [
                paramSessionId
            ],
            responses: {
                200: { description: "Lista de mensagens agendadas" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Sessão não encontrada" }
            }
        },
        post: {
            tags: ["Scheduler"],
            summary: "Criar mensagem agendada",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["jid", "sendAt"],
                            properties: {
                                jid: { type: "string" },
                                content: { type: "string" },
                                sendAt: { type: "string", format: "date-time" },
                                mediaUrl: { type: "string" },
                                mediaType: { type: "string", enum: ["image", "video", "document", "audio"] },
                                cronExpression: { type: "string" },
                                recurrenceRule: { type: "string" }
                            }
                        },
                        example: {
                            jid: "628123456789@s.whatsapp.net",
                            content: "Reminder: Meeting in 10 mins",
                            sendAt: "2024-12-25T10:00:00.000Z",
                            mediaUrl: "https://example.com/image.jpg",
                            mediaType: "image",
                            cronExpression: "*/10 * * * *",
                            recurrenceRule: "{\"type\":\"minutes\",\"value\":10}"
                        }
                    }
                }
            },
            responses: {
                200: { description: "Mensagem agendada criada" },
                400: { description: "Campos obrigatórios ausentes" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" }
            }
        }
    },
    "/scheduler/{sessionId}/{scheduleId}": {
        put: {
            tags: ["Scheduler"],
            summary: "Atualizar mensagem agendada",
            parameters: [
                paramSessionId,
                { name: "scheduleId", in: "path", required: true, schema: { type: "string" } }
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["jid", "sendAt"],
                            properties: {
                                jid: { type: "string" },
                                content: { type: "string" },
                                sendAt: { type: "string", format: "date-time" },
                                mediaUrl: { type: "string" },
                                mediaType: { type: "string", enum: ["image", "video", "document", "audio"] },
                                cronExpression: { type: "string" },
                                recurrenceRule: { type: "string" }
                            }
                        },
                        example: {
                            jid: "628123456789@s.whatsapp.net",
                            content: "Updated meeting reminder",
                            sendAt: "2024-12-25T11:00:00.000Z",
                            mediaUrl: "https://example.com/image.jpg",
                            mediaType: "image",
                            cronExpression: null,
                            recurrenceRule: null
                        }
                    }
                }
            },
            responses: {
                200: { description: "Mensagem atualizada" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Mensagem não encontrada" }
            }
        },
        delete: {
            tags: ["Scheduler"],
            summary: "Apagar mensagem agendada",
            parameters: [
                paramSessionId,
                { name: "scheduleId", in: "path", required: true, schema: { type: "string" } }
            ],
            responses: {
                200: { description: "Mensagem apagada" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Mensagem não encontrada" }
            }
        }
    },
    "/scheduler": {
        "post": {
            "tags": [
                "Scheduler"
            ],
            "summary": "Criar uma tarefa de mensagem agendada",
            "responses": {
                "200": {
                    "description": "Tarefa agendada criada"
                }
            }
        }
    },
};
