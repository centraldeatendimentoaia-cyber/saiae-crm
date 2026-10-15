import { paramId } from "../parametros";

export const pathsUsuarios = {
    "/users": {
        get: {
            tags: ["Users"],
            summary: "List users (SUPERADMIN only)",
            responses: {
                200: {
                    description: "List of users",
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
            summary: "Create user (SUPERADMIN only)",
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
                    description: "User created",
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
            summary: "Update user (SUPERADMIN only)",
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
                    description: "User updated",
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
                404: { description: "User not found" },
                500: { $ref: "#/components/responses/ServerError" }
            }
        },
        delete: {
            tags: ["Users"],
            summary: "Delete user (SUPERADMIN only)",
            parameters: [
                paramId
            ],
            responses: {
                200: {
                    description: "User deleted",
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
                404: { description: "User not found" },
                500: { $ref: "#/components/responses/ServerError" }
            }
        }
    },
    "/user/api-key": {
        get: {
            tags: ["Users"],
            summary: "Get current API key",
            responses: {
                200: {
                    description: "Current API key",
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
            summary: "Generate new API key",
            responses: {
                200: {
                    description: "New API key generated",
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
                500: { description: "Failed to generate API key" }
            }
        },
        delete: {
            tags: ["Users"],
            summary: "Revoke API key",
            responses: {
                200: {
                    description: "API key revoked",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                500: { description: "Failed to revoke API key" }
            }
        }
    },
};
