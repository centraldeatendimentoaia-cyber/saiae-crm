export const pathsAutenticacao = {
    "/auth/register": {
        "post": {
            "tags": [
                "Web Authentication"
            ],
            "summary": "Cadastrar um novo usuário",
            "description": "Cadastra um usuário pela web.",
            "requestBody": {
                "required": true,
                "content": {
                    "application/json": {
                        "schema": {
                            "type": "object",
                            "required": [
                                "name",
                                "email",
                                "password"
                            ],
                            "properties": {
                                "name": {
                                    "type": "string",
                                    "example": "John Doe"
                                },
                                "email": {
                                    "type": "string",
                                    "example": "john@example.com"
                                },
                                "password": {
                                    "type": "string",
                                    "example": "password123"
                                }
                            }
                        }
                    }
                }
            },
            "responses": {
                "200": {
                    "description": "Usuário cadastrado"
                }
            }
        }
    },
    "/auth/session": {
        get: {
            tags: ["Web Authentication"],
            summary: "Obter a sessão web atual",
            description: "Verifica se o usuário está autenticado no painel web",
            responses: {
                200: {
                    description: "Sessão atual",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    user: {
                                        type: "object",
                                        properties: {
                                            name: { type: "string" },
                                            email: { type: "string" },
                                            image: { type: "string" }
                                        }
                                    },
                                    expires: { type: "string" }
                                }
                            }
                        }
                    }
                }
            }
        }
    },
    "/auth/csrf": {
        get: {
            tags: ["Web Authentication"],
            summary: "Obter o token CSRF",
            description: "Obtém o token CSRF para envio de formulários",
            responses: {
                200: {
                    description: "Token CSRF",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    csrfToken: { type: "string" }
                                }
                            }
                        }
                    }
                }
            }
        }
    },
};
