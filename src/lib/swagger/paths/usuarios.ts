import { paramId } from "../parametros";

export const pathsUsuarios = {
    "/users": {
        get: {
            tags: ["Users"],
            summary: "Listar usuários (somente SUPERADMIN)",
            responses: {
                200: {
                    description: "Lista de usuários",
                    content: {
                        "application/json": {
                            schema: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        id: { type: "string" },
                                        name: { type: "string" },
                                        email: { type: "string" },
                                        role: { type: "string" },
                                        createdAt: { type: "string", format: "date-time" },
                                        _count: {
                                            type: "object",
                                            properties: {
                                                sessions: { type: "integer" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                500: { $ref: "#/components/responses/ServerError" }
            }
        },
        post: {
            tags: ["Users"],
            summary: "Criar usuário (somente SUPERADMIN)",
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["name", "email", "password"],
                            properties: {
                                name: { type: "string", minLength: 2 },
                                email: { type: "string", format: "email" },
                                password: { type: "string", minLength: 6 },
                                role: {
                                    type: "string",
                                    enum: ["SUPERADMIN", "OWNER", "STAFF"],
                                    default: "OWNER"
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Usuário criado",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    id: { type: "string" },
                                    name: { type: "string" },
                                    email: { type: "string" },
                                    role: { type: "string" },
                                    createdAt: { type: "string", format: "date-time" }
                                }
                            }
                        }
                    }
                },
                400: { $ref: "#/components/responses/BadRequest" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                500: { $ref: "#/components/responses/ServerError" }
            }
        }
    },
    "/users/{id}": {
        patch: {
            tags: ["Users"],
            summary: "Atualizar usuário (somente SUPERADMIN)",
            parameters: [
                paramId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                name: { type: "string" },
                                email: { type: "string" },
                                password: { type: "string" },
                                role: { type: "string", enum: ["SUPERADMIN", "OWNER", "STAFF"] }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Usuário atualizado",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean" },
                                    user: {
                                        type: "object",
                                        properties: {
                                            id: { type: "string" },
                                            email: { type: "string" },
                                            name: { type: "string" },
                                            role: { type: "string" },
                                            emailVerified: { type: "string", nullable: true },
                                            image: { type: "string", nullable: true },
                                            createdAt: { type: "string", format: "date-time" },
                                            updatedAt: { type: "string", format: "date-time" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                400: { $ref: "#/components/responses/BadRequest" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Usuário não encontrado" },
                500: { $ref: "#/components/responses/ServerError" }
            }
        },
        delete: {
            tags: ["Users"],
            summary: "Apagar usuário (somente SUPERADMIN)",
            parameters: [
                paramId
            ],
            responses: {
                200: {
                    description: "Usuário apagado",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean" },
                                    message: { type: "string" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Usuário não encontrado" },
                500: { $ref: "#/components/responses/ServerError" }
            }
        }
    },
    "/user/api-key": {
        get: {
            tags: ["Users"],
            summary: "Obter a chave de API atual",
            responses: {
                200: {
                    description: "Chave de API atual",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    apiKey: { type: "string", nullable: true }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" }
            }
        },
        post: {
            tags: ["Users"],
            summary: "Gerar uma nova chave de API",
            responses: {
                200: {
                    description: "Nova chave de API gerada",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    apiKey: { type: "string" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                500: { description: "Falha ao gerar a chave de API" }
            }
        },
        delete: {
            tags: ["Users"],
            summary: "Revogar a chave de API",
            responses: {
                200: {
                    description: "Chave de API revogada",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                500: { description: "Falha ao revogar a chave de API" }
            }
        }
    },
};
