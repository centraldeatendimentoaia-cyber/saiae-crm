import { paramJid, paramMessageId, paramSessionId } from "../parametros";

export const pathsMensagens = {
    "/messages/{sessionId}/{jid}/send": {
        post: {
            tags: ["Messaging"],
            summary: "Send message (text/media/sticker)",
            description: "Universal endpoint for sending text, images, videos, documents, and stickers. Supports mentions and all WhatsApp message types.",
            parameters: [
                {
                    name: "sessionId",
                    in: "path",
                    required: true,
                    schema: { type: "string" },
                    description: "Session identifier",
                    example: "sales-01"
                },
                {
                    name: "jid",
                    in: "path",
                    required: true,
                    schema: { type: "string" },
                    description: "Recipient JID",
                    example: "628123456789@s.whatsapp.net"
                }
            ],
            requestBody: {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["message"],
                            properties: {
                                message: {
                                    type: "object",
                                    description: "Message content (text, image, sticker, etc.)",
                                    oneOf: [
                                        {
                                            properties: {
                                                text: { type: "string", example: "Hello!" }
                                            }
                                        },
                                        {
                                            properties: {
                                                image: {
                                                    type: "object",
                                                    properties: {
                                                        url: { type: "string", example: "https://example.com/image.jpg" }
                                                    }
                                                },
                                                caption: { type: "string", example: "Check this out" }
                                            }
                                        },
                                        {
                                            properties: {
                                                sticker: {
                                                    oneOf: [
                                                        { type: "string", description: "URL to sticker image" },
                                                        {
                                                            type: "object",
                                                            properties: {
                                                                url: { type: "string" },
                                                                pack: { type: "string" },
                                                                author: { type: "string" }
                                                            }
                                                        }
                                                    ]
                                                }
                                            }
                                        }
                                    ]
                                },
                                mentions: {
                                    type: "array",
                                    items: { type: "string" },
                                    example: ["628123456789@s.whatsapp.net"],
                                    description: "List of JIDs to mention (for group messages)"
                                }
                            }
                        },
                        examples: {
                            text: {
                                summary: "Text message",
                                value: {
                                    jid: "628123456789@s.whatsapp.net",
                                    message: { text: "Hello, how can I help you?" }
                                }
                            },
                            image: {
                                summary: "Image with caption",
                                value: {
                                    jid: "628123456789@s.whatsapp.net",
                                    message: {
                                        image: { url: "https://example.com/product.jpg" },
                                        caption: "New product available!"
                                    }
                                }
                            },
                            sticker: {
                                summary: "Sticker from URL",
                                value: {
                                    jid: "628123456789@s.whatsapp.net",
                                    message: {
                                        sticker: {
                                            url: "https://example.com/sticker.webp",
                                            pack: "My Stickers",
                                            author: "Saiaê"
                                        }
                                    }
                                }
                            },
                            withMention: {
                                summary: "Message with Mention",
                                value: {
                                    jid: "120363123456789@g.us",
                                    message: { text: "Hello @628123456789, welcome!" },
                                    mentions: ["628123456789@s.whatsapp.net"]
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Message sent successfully",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" },
                            example: {
                                status: true,
                                message: "Message sent successfully",
                                data: {
                                    key: {
                                        remoteJid: "628123456789@s.whatsapp.net",
                                        fromMe: true,
                                        id: "3EB01234567890"
                                    },
                                    message: {
                                        conversation: "Hello from Saiaê!"
                                    },
                                    messageTimestamp: "1678901234"
                                }
                            }
                        }
                    }
                },
                400: { description: "Invalid request - jid and message are required" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Session not found or disconnected" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to send message" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/media": {
        post: {
            tags: ["Messaging"],
            summary: "Send media (image/video/audio/document)",
            description: "Send file using multipart/form-data",
            parameters: [
                {
                    name: "sessionId",
                    in: "path",
                    required: true,
                    schema: { type: "string" },
                    description: "Session identifier"
                },
                {
                    name: "jid",
                    in: "path",
                    required: true,
                    schema: { type: "string" },
                    description: "Recipient JID"
                }
            ],
            requestBody: {
                content: {
                    "multipart/form-data": {
                        schema: {
                            type: "object",
                            required: ["file", "type"],
                            properties: {
                                file: { type: "string", format: "binary" },
                                type: {
                                    type: "string",
                                    enum: ["image", "video", "audio", "voice", "document", "sticker"],
                                    default: "image"
                                },
                                caption: { type: "string" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Media sent successfully",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" }
                        }
                    }
                },
                400: { description: "Bad Request - File missing" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to send media" }
            }
        }
    },
    "/messages/{sessionId}/broadcast": {
        post: {
            tags: ["Messaging"],
            summary: "Broadcast message to multiple recipients",
            description: "Send same message to multiple contacts with anti-ban delays (10-20s random)",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["recipients", "message"],
                            properties: {
                                recipients: {
                                    type: "array",
                                    items: { type: "string" },
                                    example: ["628123456789@s.whatsapp.net", "628987654321@s.whatsapp.net"]
                                },
                                message: { type: "string", example: "Flash Sale! 50% off" },
                                delay: { type: "number", description: "Optional delay (unused)" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Broadcast started",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "Broadcast started in background" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to start broadcast" }
            }
        }
    },
    "/messages/{sessionId}/broadcast/history": {
        get: {
            tags: ["Messaging"],
            summary: "Get broadcast history",
            description: "Retrieve list of past broadcasts with status, sent/failed counts (persisted in DB)",
            parameters: [
                paramSessionId,
                { name: "limit", in: "query", schema: { type: "integer", default: 20 }, description: "Max results (max 50)" },
                { name: "offset", in: "query", schema: { type: "integer", default: 0 }, description: "Pagination offset" }
            ],
            responses: {
                200: {
                    description: "Broadcast history",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    status: { type: "boolean", example: true },
                                    data: {
                                        type: "array",
                                        items: { $ref: "#/components/schemas/BroadcastLog" }
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
                403: { $ref: "#/components/responses/Forbidden" }
            }
        }
    },
    "/messages/{sessionId}/broadcast/history/{logId}": {
        get: {
            tags: ["Messaging"],
            summary: "Get broadcast detail",
            description: "Retrieve full detail of a specific broadcast including per-recipient status",
            parameters: [
                paramSessionId,
                { name: "logId", in: "path", required: true, schema: { type: "string" } }
            ],
            responses: {
                200: {
                    description: "Broadcast detail",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    status: { type: "boolean", example: true },
                                    data: {
                                        type: "object",
                                        properties: {
                                            id: { type: "string" },
                                            sessionId: { type: "string" },
                                            message: { type: "string" },
                                            total: { type: "integer" },
                                            sent: { type: "integer" },
                                            failed: { type: "integer" },
                                            status: { type: "string" },
                                            delay: { type: "integer" },
                                            startedAt: { type: "string", format: "date-time" },
                                            completedAt: { type: "string", format: "date-time", nullable: true },
                                            recipients: {
                                                type: "array",
                                                items: { $ref: "#/components/schemas/BroadcastRecipient" }
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
                404: { description: "Broadcast not found" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/poll": {
        post: {
            tags: ["Messaging"],
            summary: "Send poll message",
            description: "Create interactive poll (2-12 options, single or multiple choice)",
            parameters: [
                paramSessionId,
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["question", "options"],
                            properties: {
                                question: { type: "string", example: "What's your favorite product?" },
                                options: {
                                    type: "array",
                                    items: { type: "string" },
                                    minItems: 2,
                                    maxItems: 12,
                                    example: ["Product A", "Product B", "Product C"]
                                },
                                selectableCount: { type: "integer", minimum: 1, example: 1 }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Poll sent", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to send poll" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/location": {
        post: {
            tags: ["Messaging"],
            summary: "Send location",
            description: "Share GPS coordinates with optional name and address",
            parameters: [
                paramSessionId,
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["latitude", "longitude"],
                            properties: {
                                latitude: { type: "number", minimum: -90, maximum: 90, example: -6.2088 },
                                longitude: { type: "number", minimum: -180, maximum: 180, example: 106.8456 },
                                name: { type: "string", example: "Central Park" },
                                address: { type: "string", example: "Jakarta, Indonesia" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Location sent", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to send location" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/contact": {
        post: {
            tags: ["Messaging"],
            summary: "Send contact card",
            description: "Share one or multiple contact vCards",
            parameters: [
                paramSessionId,
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["contacts"],
                            properties: {
                                contacts: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        required: ["displayName", "vcard"],
                                        properties: {
                                            displayName: { type: "string", example: "John Doe" },
                                            vcard: { type: "string", example: "BEGIN:VCARD..." }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Contact sent", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to send contact" }
            }
        }
    },
    "/messages/{sessionId}/download/{messageId}/media": {
        get: {
            tags: ["Messaging"],
            summary: "Download message media",
            description: "Download media from a message (direct binary or redirect)",
            parameters: [
                paramSessionId,
                paramMessageId
            ],
            responses: {
                200: {
                    description: "Binary media file",
                    content: {
                        "*/*": { schema: { type: "string", format: "binary" } }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { description: "Forbidden - Cannot access session or message" },
                404: { description: "Message not found or has no media" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/{messageId}/react": {
        post: {
            tags: ["Messaging"],
            summary: "React to message with emoji",
            description: "Add emoji reaction to a message (empty string removes reaction)",
            parameters: [
                paramSessionId,
                paramJid,
                paramMessageId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["emoji"],
                            properties: {
                                emoji: { type: "string", example: "👍", description: "Emoji or empty string to remove" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Reaction sent", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to send reaction" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/{messageId}/reply": {
        post: {
            tags: ["Messaging"],
            summary: "Reply to a message (quoted reply)",
            description: "Send a quoted reply to a specific message by its ID. Uses same request format as /send — pass a Baileys message object.",
            parameters: [
                { name: "sessionId", in: "path", required: true, schema: { type: "string" }, example: "sales-01" },
                { name: "jid", in: "path", required: true, schema: { type: "string" }, example: "628123456789@s.whatsapp.net" },
                { name: "messageId", in: "path", required: true, schema: { type: "string" }, description: "ID of message to reply to", example: "3EB0ABCD1234567890" }
            ],
            requestBody: {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["message"],
                            properties: {
                                message: {
                                    type: "object",
                                    description: "Message content — same format as /send (text, image, video, etc.)",
                                    example: { text: "Thanks for your message!" }
                                },
                                mentions: { type: "array", items: { type: "string" }, example: ["628123456789@s.whatsapp.net"], description: "JIDs to mention" },
                                fromMe: { type: "boolean", default: false, description: "Whether the quoted message was sent by you" }
                            }
                        },
                        examples: {
                            textReply: {
                                summary: "Text reply",
                                value: { message: { text: "Got it, thanks!" } }
                            },
                            imageReply: {
                                summary: "Image reply",
                                value: { message: { image: { url: "https://example.com/confirm.jpg" }, caption: "Confirmation image" } }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Reply sent successfully",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "Message sent successfully" }
                                }
                            }
                        }
                    }
                },
                400: { description: "message is required" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to send reply" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/reply": {
        post: {
            tags: ["Messaging"],
            summary: "Reply to a message (body-based)",
            description: "Send a quoted reply with messageId provided in the request body. Same request format as /send with added messageId.",
            parameters: [
                { name: "sessionId", in: "path", required: true, schema: { type: "string" }, example: "sales-01" },
                { name: "jid", in: "path", required: true, schema: { type: "string" }, example: "628123456789@s.whatsapp.net" }
            ],
            requestBody: {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["messageId", "message"],
                            properties: {
                                messageId: { type: "string", example: "3EB0ABCD1234567890", description: "ID of the message to reply to" },
                                message: {
                                    type: "object",
                                    description: "Message content — same format as /send (text, image, video, etc.)",
                                    example: { text: "Sure, let me help you!" }
                                },
                                mentions: { type: "array", items: { type: "string" }, description: "JIDs to mention" },
                                fromMe: { type: "boolean", default: false, description: "Whether the quoted message was sent by you" }
                            }
                        },
                        example: {
                            messageId: "3EB0ABCD1234567890",
                            message: { text: "Sure, let me check that for you!" }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Reply sent successfully",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } }
                },
                400: { description: "messageId and message required" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to send reply" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/{messageId}/star": {
        post: {
            tags: ["Messaging"],
            summary: "Star or unstar a message",
            description: "Mark a message as starred (saved) or remove the star. Starred messages appear in the Starred Messages section.",
            parameters: [
                paramSessionId,
                paramJid,
                paramMessageId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                star: { type: "boolean", example: true, default: true, description: "true to star, false to unstar" },
                                fromMe: { type: "boolean", example: false, default: false, description: "Whether the message was sent by you" }
                            }
                        },
                        examples: {
                            star: { summary: "Star message", value: { star: true } },
                            unstar: { summary: "Unstar message", value: { star: false } }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Star status updated",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "Message starred" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to star/unstar message" }
            }
        }
    },
    "/messages/{sessionId}/search": {
        get: {
            tags: ["Messaging"],
            summary: "Search messages",
            description: "Search messages stored in the database for a session. Supports full-text search, filtering by JID, type, and sender.",
            parameters: [
                { name: "sessionId", in: "path", required: true, schema: { type: "string" }, example: "sales-01" },
                { name: "q", in: "query", schema: { type: "string" }, example: "invoice", description: "Text to search for in message content" },
                { name: "jid", in: "query", schema: { type: "string" }, example: "628123456789@s.whatsapp.net", description: "Filter by chat JID" },
                { name: "type", in: "query", schema: { type: "string", enum: ["TEXT", "IMAGE", "VIDEO", "AUDIO", "DOCUMENT", "STICKER", "LOCATION", "CONTACT"] }, description: "Filter by message type" },
                { name: "fromMe", in: "query", schema: { type: "boolean" }, description: "Filter by sender (true=outgoing, false=incoming)" },
                { name: "page", in: "query", schema: { type: "integer", default: 1, minimum: 1 } },
                { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } }
            ],
            responses: {
                200: {
                    description: "Search results",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    data: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                id: { type: "string" },
                                                remoteJid: { type: "string" },
                                                fromMe: { type: "boolean" },
                                                keyId: { type: "string" },
                                                pushName: { type: "string" },
                                                type: { type: "string" },
                                                content: { type: "string" },
                                                status: { type: "string" },
                                                timestamp: { type: "string", format: "date-time" },
                                                quoteId: { type: "string", nullable: true }
                                            }
                                        }
                                    },
                                    pagination: {
                                        type: "object",
                                        properties: {
                                            total: { type: "integer" },
                                            page: { type: "integer" },
                                            limit: { type: "integer" },
                                            pages: { type: "integer" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                400: { description: "q or jid is required" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Session not found" },
                500: { description: "Failed to search messages" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/list": {
        post: {
            tags: ["Messaging"],
            summary: "Send list message",
            description: "Send a formatted numbered list message",
            parameters: [
                paramSessionId,
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["title", "options"],
                            properties: {
                                title: { type: "string", example: "Our Services" },
                                options: { type: "array", items: { type: "string" }, example: ["Web Dev", "App Dev", "UI/UX"] },
                                footer: { type: "string", example: "Choose one" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Message sent", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to send message" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/sticker": {
        post: {
            tags: ["Messaging"],
            summary: "Send sticker",
            description: "Convert an image to sticker and send it",
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
                                file: { type: "string", format: "binary" },
                                pack: { type: "string", description: "Sticker pack name (default: Saiaê)" },
                                author: { type: "string", description: "Sticker author name (default: User)" },
                                type: { type: "string", enum: ["full", "crop", "circle"], description: "Sticker crop type (default: full)" },
                                quality: { type: "integer", minimum: 1, maximum: 100, description: "Image quality (default: 50)" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Sticker sent", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to create sticker" }
            }
        }
    },
    "/messages/{sessionId}/forward": {
        post: {
            tags: ["Messaging"],
            summary: "Forward message",
            description: "Forward a message to one or multiple chats",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["fromJid", "messageId", "toJids"],
                            properties: {
                                fromJid: { type: "string", description: "Source chat JID", example: "628123456789@s.whatsapp.net" },
                                messageId: { type: "string", example: "3EB0ABCD1234567890" },
                                toJids: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Recipient JIDs",
                                    example: ["628987654321@s.whatsapp.net"]
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Message forwarded", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to forward message" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/{messageId}": {
        delete: {
            tags: ["Messaging"],
            summary: "Delete message for everyone",
            description: "Delete message (only works for messages < 7 minutes old)",
            parameters: [
                paramSessionId,
                paramJid,
                paramMessageId
            ],
            responses: {
                200: {
                    description: "Message deleted",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "Message deleted for everyone" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to delete message" }
            }
        },
        patch: {
            tags: ["Messaging"],
            summary: "Edit a sent message",
            description: "Edit text of a sent message",
            parameters: [
                paramSessionId,
                paramJid,
                paramMessageId
            ],
            requestBody: {
                required: true,
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["text"],
                            properties: {
                                text: { type: "string", example: "Updated text message" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Message edited",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    status: { type: "boolean", example: true },
                                    message: { type: "string", example: "Message edited successfully" }
                                }
                            }
                        }
                    }
                },
                400: { description: "Bad Request" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to edit message" }
            }
        }
    },
};
