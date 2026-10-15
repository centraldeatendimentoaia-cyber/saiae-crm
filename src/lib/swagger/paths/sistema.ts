import { paramSessionId } from "../parametros";

export const pathsSistema = {
    "/media/{filename}": {
        "get": {
            "tags": [
                "Media"
            ],
            "summary": "Get uploaded media file",
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
                    "description": "File data"
                }
            }
        }
    },
    "/docs": {
        "get": {
            "tags": [
                "Documentation"
            ],
            "summary": "Get Swagger JSON specification",
            "responses": {
                "200": {
                    "description": "Swagger JSON spec"
                }
            }
        }
    },
    "/settings/system": {
        get: {
            tags: ["System"],
            summary: "Get system settings",
            responses: {
                200: {
                    description: "System settings",
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
            summary: "Update system settings",
            description: "Update global system configuration (Superadmin/Owner only)",
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
                    description: "Settings updated",
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
                500: { description: "Failed to update settings" }
            }
        }
    },
    "/status/{sessionId}/update": {
        post: {
            tags: ["System"],
            summary: "Update status",
            description: "Post a status update (story) to WhatsApp. Supports text, image, and video.",
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
                                content: { type: "string", description: "Status text or caption" },
                                type: { type: "string", enum: ["TEXT", "IMAGE", "VIDEO"], default: "TEXT" },
                                mediaUrl: { type: "string", description: "Required for IMAGE and VIDEO" },
                                backgroundColor: { type: "integer" },
                                font: { type: "integer" },
                                mentions: { type: "array", items: { type: "string" } }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Status posted", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
                400: { description: "Missing required fields" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" }
            }
        }
    },
    "/status/update": {
        post: {
            tags: ["System"],
            summary: "Update status",
            description: "Post a status update (story) to WhatsApp. Supports text, image, and video.",
            requestBody: {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["sessionId", "content"],
                            properties: {
                                sessionId: { type: "string" },
                                content: { type: "string", description: "Status text or caption" },
                                type: { type: "string", enum: ["TEXT", "IMAGE", "VIDEO"], default: "TEXT" },
                                mediaUrl: { type: "string", description: "Required for IMAGE and VIDEO" },
                                backgroundColor: { type: "integer", description: "ARGB color for TEXT status" },
                                font: { type: "integer", description: "Font style for TEXT status" },
                                mentions: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "List of JIDs to mention/tag in the status"
                                }
                            }
                        },
                        examples: {
                            simple: {
                                summary: "Simple Text Status",
                                value: {
                                    sessionId: "sales-01",
                                    content: "Hello World!",
                                    type: "TEXT",
                                    backgroundColor: 4278190080
                                }
                            },
                            withMention: {
                                summary: "Status with Mention",
                                value: {
                                    sessionId: "sales-01",
                                    content: "Check this out @628123456789",
                                    type: "TEXT",
                                    backgroundColor: 4278190080,
                                    mentions: ["628123456789@s.whatsapp.net"]
                                }
                            },
                            image: {
                                summary: "Image Status",
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
                    description: "Status updated",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" }
                        }
                    }
                },
                400: { description: "Missing required fields" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { description: "Session not ready" },
                500: { description: "Failed to post status" }
            }
        }
    },
    "/system/check-updates": {
        post: {
            tags: ["System"],
            summary: "Check for updates",
            description: "Checks for new releases on GitHub and creates a system notification if a newer version is available.",
            responses: {
                200: {
                    description: "Check results",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean" },
                                    message: { type: "string" },
                                    version: { type: "string", description: "Latest version tag" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                500: { description: "Error checking updates" }
            }
        }
    },
};
