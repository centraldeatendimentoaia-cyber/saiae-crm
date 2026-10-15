export const pathsAutenticacao = {
    "/auth/register": {
        "post": {
            "tags": [
                "Web Authentication"
            ],
            "summary": "Register a new user",
            "description": "Register a user via web.",
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
                    "description": "User registered"
                }
            }
        }
    },
    "/auth/session": {
        get: {
            tags: ["Web Authentication"],
            summary: "Get current web session",
            description: "Check if the user is authenticated in the web dashboard",
            responses: {
                200: {
                    description: "Current session",
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
            summary: "Get CSRF token",
            description: "Retrieve CSRF token for form submissions",
            responses: {
                200: {
                    description: "CSRF Token",
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
