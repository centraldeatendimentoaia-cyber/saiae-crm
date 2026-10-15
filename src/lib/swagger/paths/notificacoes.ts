export const pathsNotificacoes = {
    "/notifications": {
        get: {
            tags: ["Notifications"],
            summary: "List notifications",
            description: "Get the last 50 notifications for the authenticated user",
            responses: {
                200: {
                    description: "List of notifications",
                    content: {
                        "application/json": {
                            schema: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        id: { type: "string" },
                                        userId: { type: "string" },
                                        title: { type: "string" },
                                        message: { type: "string" },
                                        type: { type: "string" },
                                        href: { type: "string", nullable: true },
                                        read: { type: "boolean" },
                                        createdAt: { type: "string", format: "date-time" }
                                    }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                500: { description: "Error fetching notifications" }
            }
        },
        post: {
            tags: ["Notifications"],
            summary: "Create notification",
            description: "Send a notification to a specific user or broadcast to all (Superadmin only)",
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["title", "message"],
                            properties: {
                                title: { type: "string", example: "Maintenance" },
                                message: { type: "string", example: "System update in 5 minutes" },
                                type: { type: "string", enum: ["INFO", "SUCCESS", "WARNING", "ERROR"], default: "INFO" },
                                href: { type: "string", example: "/settings" },
                                targetUserId: { type: "string", description: "Target user UUID" },
                                broadcast: { type: "boolean", default: false }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Notification created",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    count: { type: "integer", description: "Number of users notified if broadcast" }
                                }
                            }
                        }
                    }
                },
                400: { description: "Invalid request" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                500: { description: "Error creating notification" }
            }
        }
    },
    "/notifications/read": {
        patch: {
            tags: ["Notifications"],
            summary: "Mark notifications as read",
            description: "Mark specific or all notifications as read for the authenticated user",
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                ids: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Array of notification IDs. If omitted or empty, all notifications are marked as read."
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Notifications updated",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                500: { description: "Error updating notifications" }
            }
        }
    },
    "/notifications/delete": {
        delete: {
            tags: ["Notifications"],
            summary: "Delete specific notification",
            parameters: [
                {
                    name: "id",
                    in: "query",
                    required: true,
                    schema: { type: "string" },
                    description: "Notification UUID"
                }
            ],
            responses: {
                200: {
                    description: "Notification deleted",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" }
                        }
                    }
                },
                400: { description: "Notification ID required" },
                401: { $ref: "#/components/responses/Unauthorized" },
                500: { description: "Error deleting notification" }
            }
        }
    },
};
