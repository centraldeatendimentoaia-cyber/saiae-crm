import { paramJid, paramSessionId } from "../parametros";

export const pathsGrupos = {
    "/groups/{sessionId}/{jid}/leave": {
        "post": {
            "tags": [
                "Groups"
            ],
            "summary": "Sair de um grupo",
            "parameters": [
                {
                    "name": "sessionId",
                    "in": "path",
                    "required": true,
                    "schema": {
                        "type": "string"
                    }
                },
                {
                    "name": "jid",
                    "in": "path",
                    "required": true,
                    "schema": {
                        "type": "string"
                    }
                }
            ],
            "responses": {
                "200": {
                    "description": "Saiu do grupo com sucesso"
                }
            }
        }
    },
    "/groups/{sessionId}": {
        get: {
            tags: ["Groups"],
            summary: "Listar todos os grupos",
            description: "Obtém todos os grupos associados à sessão",
            parameters: [
                paramSessionId
            ],
            responses: {
                200: { description: "Lista de grupos", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Group" } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { $ref: "#/components/responses/NotFound" },
                500: { description: "Falha ao buscar os grupos" }
            }
        }
    },
    "/groups/{sessionId}/create": {
        post: {
            tags: ["Groups"],
            summary: "Criar um novo grupo",
            description: "Cria um novo grupo com os participantes informados",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["subject", "participants"],
                            properties: {
                                subject: { type: "string", maxLength: 100, example: "VIP Customers" },
                                participants: {
                                    type: "array",
                                    items: { type: "string" },
                                    example: ["628123456789@s.whatsapp.net"]
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Grupo criado", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, group: { $ref: "#/components/schemas/Group" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao criar o grupo" }
            }
        }
    },
    "/groups/{sessionId}/{jid}/subject": {
        put: {
            tags: ["Groups"],
            summary: "Atualizar o assunto do grupo",
            parameters: [
                paramSessionId,
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["subject"],
                            properties: {
                                subject: { type: "string", maxLength: 100 }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Assunto atualizado", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" }, subject: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                400: { description: "Assunto inválido" },
                500: { description: "Falha ao atualizar o assunto" }
            }
        }
    },
    "/groups/{jid}/subject": {
        put: {
            tags: ["Groups"],
            summary: "Atualizar o nome do grupo",
            description: "Atualiza o assunto do grupo (até 100 caracteres, exige ser administrador)",
            parameters: [
                { name: "jid", in: "path", required: true, schema: { type: "string" }, description: "JID do grupo codificado para URL" }
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["sessionId", "subject"],
                            properties: {
                                sessionId: { type: "string" },
                                subject: { type: "string", maxLength: 100 }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Assunto atualizado",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "Group subject updated successfully" },
                                    subject: { type: "string", example: "New Subject" }
                                }
                            }
                        }
                    }
                },
                400: { description: "Requisição inválida (campos ausentes ou assunto longo demais)" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao atualizar o assunto do grupo" }
            }
        }
    },
    "/groups/{sessionId}/{jid}/members": {
        put: {
            tags: ["Groups"],
            summary: "Gerenciar os membros do grupo",
            parameters: [
                paramSessionId,
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["action", "participants"],
                            properties: {
                                action: { type: "string", enum: ["add", "remove", "promote", "demote"] },
                                participants: { type: "array", items: { type: "string" } }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Membros atualizados", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" }, result: { type: "array", items: { type: "object" } } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                400: { description: "Ação inválida" },
                500: { description: "Falha ao atualizar os membros" }
            }
        }
    },
    "/groups/{sessionId}/{jid}/invite": {
        get: {
            tags: ["Groups"],
            summary: "Obter o código de convite",
            parameters: [
                paramSessionId,
                paramJid
            ],
            responses: {
                200: { description: "Código de convite", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, inviteCode: { type: "string" }, inviteUrl: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                500: { description: "Falha ao obter o código" }
            }
        },
        put: {
            tags: ["Groups"],
            summary: "Revogar o código de convite",
            parameters: [
                paramSessionId,
                paramJid
            ],
            responses: {
                200: { description: "Convite revogado", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" }, newInviteCode: { type: "string" }, inviteUrl: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                500: { description: "Falha ao revogar o código" }
            }
        }
    },
    "/groups/{sessionId}/{jid}": {
        get: {
            tags: ["Groups"],
            summary: "Obter os detalhes do grupo",
            description: "Obtém informações detalhadas do grupo",
            parameters: [
                paramSessionId,
                paramJid
            ],
            responses: {
                200: {
                    description: "Detalhes do grupo",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/GroupDetails" } } }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { $ref: "#/components/responses/NotFound" },
                500: { description: "Falha ao buscar os detalhes" }
            }
        }
    },
    "/groups/{jid}/leave": {
        post: {
            tags: ["Groups"],
            summary: "Sair do grupo",
            parameters: [
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["sessionId"],
                            properties: {
                                sessionId: { type: "string" }
                            }
                        }
                    }
                }
            },
            responses: { 200: { description: "Saiu do grupo" } }
        }
    },
    "/groups/{sessionId}/invite/accept": {
        post: {
            tags: ["Groups"],
            summary: "Aceitar convite de grupo",
            description: "Entra em um grupo usando um código de convite",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["inviteCode"],
                            properties: {
                                inviteCode: { type: "string" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Convite de grupo aceito", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" }, groupJid: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                400: { description: "Código inválido ou expirado" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao aceitar o convite" }
            }
        }
    },
    "/groups/{sessionId}/{jid}/picture": {
        put: {
            tags: ["Groups"],
            summary: "Atualizar a foto do grupo",
            parameters: [
                paramSessionId,
                paramJid
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
            responses: { 200: { description: "Foto atualizada" } }
        },
        delete: {
            tags: ["Groups"],
            summary: "Remover a foto do grupo",
            parameters: [
                paramSessionId,
                paramJid
            ],
            responses: { 200: { description: "Foto removida" } }
        }
    },
    "/groups/{sessionId}/{jid}/settings": {
        put: {
            tags: ["Groups"],
            summary: "Atualizar as configurações do grupo",
            parameters: [
                paramSessionId,
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["setting"],
                            properties: {
                                setting: {
                                    type: "string",
                                    enum: ["announcement", "not_announcement", "locked", "unlocked"],
                                    description: "announcement (só administradores enviam), not_announcement (todos enviam), locked (só administradores editam), unlocked (todos editam)"
                                },
                                value: { type: "boolean", description: "Ignorado, mas obrigatório" }
                            }
                        }
                    }
                }
            },
            responses: { 200: { description: "Configurações atualizadas" } }
        }
    },
    "/groups/{sessionId}/{jid}/description": {
        put: {
            tags: ["Groups"],
            summary: "Atualizar a descrição do grupo",
            parameters: [
                paramSessionId,
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                description: { type: "string", maxLength: 512 }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Descrição atualizada", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, description: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                400: { description: "Dados inválidos" },
                500: { description: "Falha ao atualizar" }
            }
        }
    },
    "/groups/{sessionId}/{jid}/ephemeral": {
        put: {
            tags: ["Groups"],
            summary: "Ativar ou desativar mensagens temporárias",
            parameters: [
                paramSessionId,
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["expiration"],
                            properties: {
                                expiration: { type: "integer", enum: [0, 86400, 604800, 7776000] }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Mensagens temporárias alteradas", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, expiration: { type: "integer" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                400: { description: "Expiração inválida" },
                500: { description: "Falha ao alterar" }
            }
        }
    },
};
