import { paramSessionId } from "../parametros";

export const pathsAutomacao = {
    "/autoreplies/{sessionId}": {
        "delete": {
            "tags": [
                "Auto Replies"
            ],
            "summary": "Delete all autoreplies",
            "parameters": [
                {
                    "name": "sessionId",
                    "in": "path",
                    "required": true,
                    "schema": {
                        "type": "string"
                    }
                }
            ],
            "responses": {
                "200": {
                    "description": "Autoreplies deleted"
                }
            }
        },
        get: {
            tags: ["Auto Reply"],
            summary: "List auto-reply rules",
            parameters: [
                paramSessionId
            ],
            responses: {
                200: { description: "List of auto-reply rules" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Session not found" }
            }
        },
        post: {
            tags: ["Auto Reply"],
            summary: "Create auto-reply rule",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["keyword"],
                            properties: {
                                keyword: { type: "string" },
                                response: { type: "string" },
                                matchType: { type: "string", enum: ["EXACT", "CONTAINS", "STARTS_WITH", "REGEX"] },
                                isMedia: { type: "boolean" },
                                mediaUrl: { type: "string" },
                                mediaType: { type: "string", enum: ["image", "video", "document", "audio"] },
                                triggerType: { type: "string", enum: ["ALL", "GROUP", "PRIVATE"] }
                            }
                        },
                        example: {
                            keyword: "hello",
                            response: "Hi there! How can I help?",
                            matchType: "EXACT",
                            triggerType: "ALL",
                            isMedia: false,
                            mediaUrl: null,
                            mediaType: null
                        }
                    }
                }
            },
            responses: {
                200: { description: "Rule created" },
                400: { description: "Missing required fields" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" }
            }
        }
    },
    "/autoreplies/{sessionId}/{replyId}": {
        put: {
            tags: ["Auto Reply"],
            summary: "Update auto-reply rule",
            parameters: [
                paramSessionId,
                { name: "replyId", in: "path", required: true, schema: { type: "string" } }
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["keyword"],
                            properties: {
                                keyword: { type: "string" },
                                response: { type: "string" },
                                isMedia: { type: "boolean" },
                                mediaUrl: { type: "string" },
                                mediaType: { type: "string", enum: ["image", "video", "document", "audio"] },
                                triggerType: { type: "string", enum: ["ALL", "GROUP", "PRIVATE"] }
                            }
                        },
                        example: {
                            keyword: "hello",
                            response: "Hi there! How can I help?",
                            matchType: "EXACT",
                            triggerType: "ALL",
                            isMedia: false,
                            mediaUrl: null,
                            mediaType: null
                        }
                    }
                }
            },
            responses: {
                200: { description: "Rule updated" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Rule not found" }
            }
        },
        delete: {
            tags: ["Auto Reply"],
            summary: "Delete auto-reply rule",
            parameters: [
                paramSessionId,
                { name: "replyId", in: "path", required: true, schema: { type: "string" } }
            ],
            responses: {
                200: { description: "Rule deleted" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Rule not found" }
            }
        }
    },
    "/scheduler/{sessionId}": {
        "delete": {
            "tags": [
                "Scheduler"
            ],
            "summary": "Delete all scheduled messages for a session",
            "parameters": [
                {
                    "name": "sessionId",
                    "in": "path",
                    "required": true,
                    "schema": {
                        "type": "string"
                    }
                }
            ],
            "responses": {
                "200": {
                    "description": "Scheduled messages deleted"
                }
            }
        },
        get: {
            tags: ["Scheduler"],
            summary: "List scheduled messages",
            parameters: [
                paramSessionId
            ],
            responses: {
                200: { description: "List of scheduled messages" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Session not found" }
            }
        },
        post: {
            tags: ["Scheduler"],
            summary: "Create scheduled message",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["jid", "sendAt"],
                            properties: {
                                jid: { type: "string" },
                                content: { type: "string" },
                                sendAt: { type: "string", format: "date-time" },
                                mediaUrl: { type: "string" },
                                mediaType: { type: "string", enum: ["image", "video", "document", "audio"] },
                                cronExpression: { type: "string" },
                                recurrenceRule: { type: "string" }
                            }
                        },
                        example: {
                            jid: "628123456789@s.whatsapp.net",
                            content: "Reminder: Meeting in 10 mins",
                            sendAt: "2024-12-25T10:00:00.000Z",
                            mediaUrl: "https://example.com/image.jpg",
                            mediaType: "image",
                            cronExpression: "*/10 * * * *",
                            recurrenceRule: "{\"type\":\"minutes\",\"value\":10}"
                        }
                    }
                }
            },
            responses: {
                200: { description: "Scheduled message created" },
                400: { description: "Missing required fields" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" }
            }
        }
    },
    "/scheduler/{sessionId}/{scheduleId}": {
        put: {
            tags: ["Scheduler"],
            summary: "Update scheduled message",
            parameters: [
                paramSessionId,
                { name: "scheduleId", in: "path", required: true, schema: { type: "string" } }
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["jid", "sendAt"],
                            properties: {
                                jid: { type: "string" },
                                content: { type: "string" },
                                sendAt: { type: "string", format: "date-time" },
                                mediaUrl: { type: "string" },
                                mediaType: { type: "string", enum: ["image", "video", "document", "audio"] },
                                cronExpression: { type: "string" },
                                recurrenceRule: { type: "string" }
                            }
                        },
                        example: {
                            jid: "628123456789@s.whatsapp.net",
                            content: "Updated meeting reminder",
                            sendAt: "2024-12-25T11:00:00.000Z",
                            mediaUrl: "https://example.com/image.jpg",
                            mediaType: "image",
                            cronExpression: null,
                            recurrenceRule: null
                        }
                    }
                }
            },
            responses: {
                200: { description: "Message updated" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Message not found" }
            }
        },
        delete: {
            tags: ["Scheduler"],
            summary: "Delete scheduled message",
            parameters: [
                paramSessionId,
                { name: "scheduleId", in: "path", required: true, schema: { type: "string" } }
            ],
            responses: {
                200: { description: "Message deleted" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Message not found" }
            }
        }
    },
    "/scheduler": {
        "post": {
            "tags": [
                "Scheduler"
            ],
            "summary": "Create a scheduled message task",
            "responses": {
                "200": {
                    "description": "Scheduled task created"
                }
            }
        }
    },
};
