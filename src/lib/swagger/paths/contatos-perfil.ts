import { paramJid, paramSessionId } from "../parametros";

export const pathsContatosPerfil = {
    "/profile/{sessionId}": {
        get: {
            tags: ["Profile"],
            summary: "Get own profile",
            description: "Fetch profile information of the connected WhatsApp account",
            parameters: [
                paramSessionId
            ],
            responses: {
                200: {
                    description: "Profile info",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean" },
                                    jid: { type: "string" },
                                    status: { type: "object" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" }
            }
        }
    },
    "/profile/{sessionId}/name": {
        put: {
            tags: ["Profile"],
            summary: "Update profile name",
            description: "Update the WhatsApp display name (max 25 chars)",
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
                                name: { type: "string", maxLength: 25 }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Name updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" }
            }
        }
    },
    "/profile/{sessionId}/status": {
        put: {
            tags: ["Profile"],
            summary: "Update profile status",
            description: "Update the WhatsApp about/status (max 139 chars)",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["status"],
                            properties: {
                                status: { type: "string", maxLength: 139 }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Status updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" }
            }
        }
    },
    "/profile/{sessionId}/picture": {
        put: {
            tags: ["Profile"],
            summary: "Update profile picture",
            description: "Upload a new profile picture",
            parameters: [
                paramSessionId
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
            responses: {
                200: { description: "Picture updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" }
            }
        },
        delete: {
            tags: ["Profile"],
            summary: "Remove profile picture",
            parameters: [
                paramSessionId
            ],
            responses: {
                200: { description: "Picture removed", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" }
            }
        }
    },
    "/contacts/{sessionId}/{jid}/block": {
        post: {
            tags: ["Contacts"],
            summary: "Block contact",
            parameters: [
                paramSessionId,
                paramJid
            ],
            responses: {
                200: { description: "Contact blocked", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                500: { description: "Failed to block contact" }
            }
        }
    },
    "/contacts/{sessionId}/{jid}/unblock": {
        post: {
            tags: ["Contacts"],
            summary: "Unblock contact",
            parameters: [
                paramSessionId,
                paramJid
            ],
            responses: {
                200: { description: "Contact unblocked", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                500: { description: "Failed to unblock contact" }
            }
        }
    },
};
