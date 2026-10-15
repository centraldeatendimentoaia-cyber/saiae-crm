import { paramId } from "../parametros";

export const pathsSessoes = {
    "/sessions": {
        get: {
            tags: ["Sessions"],
            summary: "List all accessible sessions",
            description: "Get all sessions accessible to the authenticated user (role-based filtering)",
            responses: {
                200: {
                    description: "List of sessions",
                    content: {
                        "application/json": {
                            schema: {
                                type: "array",
                                items: { $ref: "#/components/schemas/Session" }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" }
            }
        },
        post: {
            tags: ["Sessions"],
            summary: "Create new WhatsApp session",
            description: "Creates a new WhatsApp session for QR code pairing",
            requestBody: {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["name"],
                            properties: {
                                name: { type: "string", example: "Sales Bot", description: "Display name for the session" },
                                sessionId: { type: "string", example: "sales-01", description: "Unique session ID (auto-generated if not provided)" }
                            }
                        },
                        example: {
                            name: "Marketing Bot",
                            sessionId: "marketing-1"
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Session created successfully",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Session" }
                        }
                    }
                },
                400: { description: "Invalid request body" },
                401: { $ref: "#/components/responses/Unauthorized" }
            }
        }
    },
    "/sessions/{id}/qr": {
        get: {
            tags: ["Sessions"],
            summary: "Get QR code for pairing",
            description: "Retrieve QR code (string and base64 image) for WhatsApp pairing",
            parameters: [
                {
                    name: "id",
                    in: "path",
                    required: true,
                    schema: { type: "string" },
                    description: "Session ID",
                    example: "sales-01"
                }
            ],
            responses: {
                200: {
                    description: "QR code generated",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean" },
                                    qr: { type: "string", description: "QR code string" },
                                    base64: { type: "string", description: "Base64 data URL for image" }
                                }
                            },
                            example: { status: true, message: "QR code generated", data: { success: true, qr: "2@AbCdEfGhIjKlMnOp...", base64: "data:image/png;base64,iVBORw0KGgo..." } }
                        }
                    }
                },
                400: { description: "Already connected" },
                404: { description: "QR not available yet" }
            }
        }
    },
    "/sessions/{id}/bot-config": {
        get: {
            tags: ["Sessions"],
            summary: "Get bot configuration",
            parameters: [paramId],
            responses: { 200: { description: "Bot configuration retrieved" } }
        },
        post: {
            tags: ["Sessions"],
            summary: "Update bot configuration",
            parameters: [paramId],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                enabled: { type: "boolean" },
                                botMode: { type: "string", enum: ["OWNER", "SPECIFIC", "BLACKLIST", "ALL"] },
                                botAllowedJids: { type: "array", items: { type: "string" } },
                                botBlockedJids: { type: "array", items: { type: "string" } },
                                autoReplyMode: { type: "string", enum: ["OWNER", "SPECIFIC", "BLACKLIST", "ALL"] },
                                autoReplyAllowedJids: { type: "array", items: { type: "string" } },
                                autoReplyBlockedJids: { type: "array", items: { type: "string" } },
                                botName: { type: "string" },
                                enableSticker: { type: "boolean" },
                                enableVideoSticker: { type: "boolean" },
                                maxStickerDuration: { type: "integer" },
                                enablePing: { type: "boolean" },
                                enableUptime: { type: "boolean" },
                                removeBgApiKey: { type: "string", nullable: true }
                            }
                        },
                        example: {
                            enabled: true,
                            botMode: "BLACKLIST",
                            botBlockedJids: ["628123456789@s.whatsapp.net"],
                            autoReplyMode: "SPECIFIC",
                            autoReplyAllowedJids: ["628123456789@s.whatsapp.net"],
                            botName: "My Assistant",
                            enableSticker: true
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Configuration updated",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    id: { type: "string" },
                                    sessionId: { type: "string" },
                                    enabled: { type: "boolean" },
                                    botMode: { type: "string" },
                                    botAllowedJids: { type: "array", items: { type: "string" } },
                                    autoReplyMode: { type: "string" },
                                    autoReplyAllowedJids: { type: "array", items: { type: "string" } },
                                    botName: { type: "string" },
                                    enableSticker: { type: "boolean" },
                                    enableVideoSticker: { type: "boolean" },
                                    maxStickerDuration: { type: "integer" },
                                    enablePing: { type: "boolean" },
                                    enableUptime: { type: "boolean" },
                                    removeBgApiKey: { type: "string", nullable: true },
                                    createdAt: { type: "string", format: "date-time" },
                                    updatedAt: { type: "string", format: "date-time" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Session not found" },
                500: { description: "Internal Server Error" }
            }
        }
    },
    "/sessions/{id}": {
        get: {
            tags: ["Sessions"],
            summary: "Get session details",
            description: "Get detailed information about a specific session including uptime and status",
            parameters: [
                paramId
            ],
            responses: {
                200: {
                    description: "Session details",
                    content: {
                        "application/json": {
                            schema: {
                                allOf: [
                                    { $ref: "#/components/schemas/Session" },
                                    {
                                        type: "object",
                                        properties: {
                                            uptime: { type: "integer", description: "Uptime in seconds" },
                                            messageCount: { type: "integer" },
                                            hasInstance: { type: "boolean" },
                                            me: { type: "object", nullable: true }
                                        }
                                    }
                                ]
                            }
                        }
                    }
                },
                404: { description: "Session not found" }
            }
        }
    },
    "/sessions/{id}/{action}": {
        post: {
            tags: ["Sessions"],
            summary: "Perform session action",
            description: "Start, stop, restart, or logout a session",
            parameters: [
                paramId,
                { name: "action", in: "path", required: true, schema: { type: "string", enum: ["start", "stop", "restart", "logout"] } }
            ],
            responses: {
                200: {
                    description: "Action performed successfully",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" }
                        }
                    }
                },
                400: { description: "Invalid action" },
                500: { description: "Action failed" }
            }
        }
    },
    "/sessions/{id}/settings": {
        patch: {
            tags: ["Sessions"],
            summary: "Update session settings",
            parameters: [paramId],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                config: {
                                    type: "object",
                                    properties: {
                                        readReceipts: { type: "boolean" },
                                        rejectCalls: { type: "boolean" }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            responses: { 200: { description: "Settings updated" } }
        },
        delete: {
            tags: ["Sessions"],
            summary: "Delete session and logout",
            description: "Permanently deletes session and logs out from WhatsApp",
            parameters: [paramId],
            responses: {
                200: {
                    description: "Session deleted",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" }
                        }
                    }
                }
            }
        }
    },
    "/sessions/{sessionId}/access": {
        get: {
            tags: ["Session Access"],
            summary: "List users with shared access",
            description: "Get all users who have been granted access to the specified session. Only the session owner or SUPERADMIN can use this endpoint.",
            parameters: [
                { name: "sessionId", in: "path", required: true, schema: { type: "string" }, description: "Session ID (slug or CUID)", example: "marketing-1" }
            ],
            responses: {
                200: {
                    description: "Access list retrieved",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    status: { type: "boolean", example: true },
                                    message: { type: "string", example: "Access list retrieved successfully" },
                                    data: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                id: { type: "string" },
                                                sessionId: { type: "string" },
                                                userId: { type: "string" },
                                                createdAt: { type: "string", format: "date-time" },
                                                user: {
                                                    type: "object",
                                                    properties: {
                                                        id: { type: "string" },
                                                        name: { type: "string" },
                                                        email: { type: "string" },
                                                        role: { type: "string" }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { description: "Forbidden - Only session owner can manage access" },
                404: { description: "Session not found" }
            }
        },
        post: {
            tags: ["Session Access"],
            summary: "Grant access to another user",
            description: "Grant session access to another registered user by email. Only the session owner or SUPERADMIN can use this endpoint. Cannot grant access to the session owner or SUPERADMINs.",
            parameters: [
                { name: "sessionId", in: "path", required: true, schema: { type: "string" }, description: "Session ID (slug or CUID)", example: "marketing-1" }
            ],
            requestBody: {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["email"],
                            properties: {
                                email: { type: "string", format: "email", description: "Email of the user to grant access", example: "staff@example.com" }
                            }
                        }
                    }
                }
            },
            responses: {
                201: {
                    description: "Access granted successfully",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    status: { type: "boolean", example: true },
                                    message: { type: "string", example: "Access granted to staff@example.com" },
                                    data: {
                                        type: "object",
                                        properties: {
                                            id: { type: "string" },
                                            sessionId: { type: "string" },
                                            userId: { type: "string" },
                                            createdAt: { type: "string", format: "date-time" },
                                            user: {
                                                type: "object",
                                                properties: {
                                                    id: { type: "string" },
                                                    name: { type: "string" },
                                                    email: { type: "string" },
                                                    role: { type: "string" }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                400: { description: "Validation error / Cannot grant to owner / SUPERADMIN already has access" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { description: "Forbidden - Only session owner can manage access" },
                404: { description: "Session or user not found" },
                409: { description: "User already has access to this session" }
            }
        },
        delete: {
            tags: ["Session Access"],
            summary: "Revoke user access",
            description: "Remove shared access for a user from the specified session. Only the session owner or SUPERADMIN can use this endpoint.",
            parameters: [
                { name: "sessionId", in: "path", required: true, schema: { type: "string" }, description: "Session ID (slug or CUID)", example: "marketing-1" }
            ],
            requestBody: {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["userId"],
                            properties: {
                                userId: { type: "string", description: "CUID of the user to revoke access from", example: "clx456ghi" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Access revoked successfully",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" }
                        }
                    }
                },
                400: { description: "Validation error" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { description: "Forbidden - Only session owner can manage access" },
                404: { description: "Session or access record not found" }
            }
        }
    },
};
