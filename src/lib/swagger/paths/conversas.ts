import { paramLabelId, paramSessionId } from "../parametros";

export const pathsConversas = {
    "/chats/by-label/{labelId}": {
        "get": {
            "tags": [
                "Chats"
            ],
            "summary": "Get chats by label ID",
            "parameters": [
                {
                    "name": "labelId",
                    "in": "path",
                    "required": true,
                    "schema": {
                        "type": "string"
                    }
                }
            ],
            "responses": {
                "200": {
                    "description": "List of chats with the label"
                }
            }
        }
    },
    "/chat/{sessionId}": {
        get: {
            tags: ["Chat"],
            summary: "Get chat list with contacts",
            description: "Retrieve all contacts with last message for a session",
            parameters: [
                paramSessionId
            ],
            responses: {
                200: {
                    description: "Chat list",
                    content: {
                        "application/json": {
                            schema: {
                                type: "array",
                                items: { $ref: "#/components/schemas/Contact" }
                            }
                        }
                    }
                }
            }
        }
    },
    "/chat/{sessionId}/{jid}": {
        get: {
            tags: ["Chat"],
            summary: "Get message history",
            description: "Fetch up to 100 messages for a chat (enriched with participant info for groups)",
            parameters: [
                paramSessionId,
                { name: "jid", in: "path", required: true, schema: { type: "string" }, description: "URL-encoded JID" }
            ],
            responses: { 200: { description: "Message history (max 100 messages)" } }
        }
    },
    "/chat/{sessionId}/{jid}/read": {
        put: {
            tags: ["Chat"],
            summary: "Mark messages as read",
            description: "Mark specific messages or entire chat as read using RESTful path parameters",
            parameters: [
                { name: "sessionId", in: "path", required: true, schema: { type: "string" }, description: "Session identifier" },
                { name: "jid", in: "path", required: true, schema: { type: "string" }, description: "URL-encoded WhatsApp JID" }
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                messageIds: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Optional: specific message IDs to mark as read. If not provided, marks entire chat as read"
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Messages marked as read",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "Messages marked as read" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to mark messages as read" }
            }
        }
    },
    "/chat/{sessionId}/{jid}/archive": {
        put: {
            tags: ["Chat"],
            summary: "Archive/unarchive chat",
            description: "Archive or unarchive a chat using RESTful path parameters",
            parameters: [
                paramSessionId,
                { name: "jid", in: "path", required: true, schema: { type: "string" }, description: "URL-encoded JID" }
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["archive"],
                            properties: {
                                archive: { type: "boolean", description: "true to archive, false to unarchive" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Chat archived/unarchived",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "Chat archived" }
                                }
                            }
                        }
                    }
                },
                400: { description: "Missing required fields" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to archive/unarchive chat" }
            }
        }
    },
    "/chat/{sessionId}/{jid}/mute": {
        put: {
            tags: ["Chat"],
            summary: "Mute/unmute chat",
            description: "Mute chat with optional duration (default 8 hours)",
            parameters: [
                paramSessionId,
                { name: "jid", in: "path", required: true, schema: { type: "string" }, description: "URL-encoded JID" }
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["mute"],
                            properties: {
                                mute: { type: "boolean" },
                                duration: { type: "integer", description: "Duration in seconds (default: 8 hours)", example: 3600 }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Chat muted/unmuted",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "Chat muted" }
                                }
                            }
                        }
                    }
                },
                400: { description: "Missing required fields" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to mute/unmute chat" }
            }
        }
    },
    "/chat/{sessionId}/{jid}/pin": {
        put: {
            tags: ["Chat"],
            summary: "Pin/unpin chat",
            description: "Pin or unpin a chat",
            parameters: [
                paramSessionId,
                { name: "jid", in: "path", required: true, schema: { type: "string" }, description: "URL-encoded JID" }
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["pin"],
                            properties: {
                                pin: { type: "boolean" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Chat pinned/unpinned",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "Chat pinned" }
                                }
                            }
                        }
                    }
                },
                400: { description: "Missing required fields" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to pin/unpin chat" }
            }
        }
    },
    "/chat/{sessionId}/{jid}/presence": {
        post: {
            tags: ["Chat"],
            summary: "Send presence (typing/recording)",
            description: "Send presence status (typing, recording, online, etc.) to a chat",
            parameters: [
                paramSessionId,
                { name: "jid", in: "path", required: true, schema: { type: "string" }, description: "URL-encoded JID" }
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["presence"],
                            properties: {
                                presence: {
                                    type: "string",
                                    enum: ["composing", "recording", "paused", "available", "unavailable"],
                                    example: "composing"
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Presence sent",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "Presence 'composing' sent to 628123456789@s.whatsapp.net" }
                                }
                            }
                        }
                    }
                },
                400: { description: "Missing required fields or invalid presence" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to send presence" }
            }
        }
    },
    "/chat/{sessionId}/{jid}/profile-picture": {
        post: {
            tags: ["Chat"],
            summary: "Get profile picture URL",
            description: "Get profile picture URL for a contact or group",
            parameters: [
                paramSessionId,
                { name: "jid", in: "path", required: true, schema: { type: "string" }, description: "URL-encoded JID" }
            ],
            responses: {
                200: {
                    description: "Profile picture URL",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    jid: { type: "string", example: "628123456789@s.whatsapp.net" },
                                    profilePicUrl: { type: "string", nullable: true, example: "https://pps.whatsapp.net/..." },
                                    message: { type: "string", example: "No profile picture found" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to fetch profile picture" }
            }
        }
    },
    "/chat/{sessionId}/check": {
        post: {
            tags: ["Chat"],
            summary: "Check if numbers exist on WhatsApp",
            description: "Validate phone numbers (max 50 per request)",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["numbers"],
                            properties: {
                                numbers: {
                                    type: "array",
                                    items: { type: "string" },
                                    maxItems: 50,
                                    example: ["628123456789", "628987654321"]
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Validation results",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean" },
                                    results: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                number: { type: "string" },
                                                exists: { type: "boolean" },
                                                jid: { type: "string", nullable: true },
                                                error: { type: "string", nullable: true }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                400: { description: "Missing required fields" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to check numbers" }
            }
        }
    },
    "/chats/{sessionId}/by-label/{labelId}": {
        get: {
            tags: ["Labels"],
            summary: "Get chats by label",
            description: "Get all chats associated with a specific label",
            parameters: [
                paramSessionId,
                paramLabelId
            ],
            responses: {
                200: {
                    description: "List of chats with label",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean" },
                                    label: { type: "object" },
                                    chats: { type: "array", items: { type: "string" } },
                                    count: { type: "integer" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Label not found" }
            }
        }
    },
};
