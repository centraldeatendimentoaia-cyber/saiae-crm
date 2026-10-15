import { paramId, paramSessionId } from "../parametros";

export const pathsWebhooks = {
    "/webhooks/{sessionId}": {
        get: {
            tags: ["Webhooks"],
            summary: "List webhooks for a session",
            parameters: [
                paramSessionId
            ],
            responses: {
                200: { description: "List of webhooks" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" }
            }
        },
        post: {
            tags: ["Webhooks"],
            summary: "Create a webhook",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["name", "url", "events"],
                            properties: {
                                name: { type: "string" },
                                url: { type: "string" },
                                secret: { type: "string" },
                                events: { type: "array", items: { type: "string" } }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Webhook created" },
                400: { description: "Invalid input" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" }
            }
        }
    },
    "/webhooks/{sessionId}/{id}": {
        put: {
            tags: ["Webhooks"],
            summary: "Update webhook",
            parameters: [
                paramSessionId,
                paramId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                name: { type: "string" },
                                url: { type: "string" },
                                secret: { type: "string" },
                                events: { type: "array", items: { type: "string" } },
                                isActive: { type: "boolean" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Webhook updated" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Webhook not found" }
            }
        },
        delete: {
            tags: ["Webhooks"],
            summary: "Delete webhook",
            parameters: [
                paramSessionId,
                paramId
            ],
            responses: {
                200: { description: "Webhook deleted" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Webhook not found" }
            }
        }
    },
    "/webhooks/{id}": {
        delete: {
            tags: ["Webhooks"],
            summary: "Delete webhook",
            parameters: [
                paramId
            ],
            responses: {
                200: {
                    description: "Webhook deleted",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                404: { description: "Webhook not found" },
                500: { $ref: "#/components/responses/ServerError" }
            }
        }
    },
    "/webhooks/{sessionId}/{id}/test": {
        post: {
            tags: ["Webhooks"],
            summary: "Test webhook endpoint",
            description: "Fire a test payload to verify the webhook endpoint is reachable and responding correctly",
            parameters: [
                paramSessionId,
                paramId
            ],
            responses: {
                200: {
                    description: "Test result",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    status: { type: "boolean" },
                                    message: { type: "string" },
                                    data: {
                                        type: "object",
                                        properties: {
                                            success: { type: "boolean" },
                                            statusCode: { type: "integer" },
                                            responseBody: { type: "string" },
                                            responseTimeMs: { type: "integer" },
                                            error: { type: "string" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Webhook not found" }
            }
        }
    },
    "/webhooks/{sessionId}/{id}/logs": {
        get: {
            tags: ["Webhooks"],
            summary: "Get webhook delivery logs",
            description: "Retrieve delivery history for a specific webhook",
            parameters: [
                paramSessionId,
                paramId,
                { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
                { name: "offset", in: "query", schema: { type: "integer", default: 0 } }
            ],
            responses: {
                200: {
                    description: "Webhook delivery logs",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    status: { type: "boolean" },
                                    data: {
                                        type: "array",
                                        items: { $ref: "#/components/schemas/WebhookLog" }
                                    },
                                    total: { type: "integer" },
                                    limit: { type: "integer" },
                                    offset: { type: "integer" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Webhook not found" }
            }
        }
    },
};
