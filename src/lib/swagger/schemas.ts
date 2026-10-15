// Modelos reutilizáveis referenciados por #/components/schemas/*.

export const schemas = {
    // Common Schemas
    Error: {
        type: "object",
        properties: {
            status: { type: "boolean", example: false },
            message: { type: "string", example: "Error occurred" },
            error: { type: "string", example: "Detailed error info" }
        }
    },
    Success: {
        type: "object",
        properties: {
            status: { type: "boolean", example: true },
            message: { type: "string", example: "Operation successful" },
            data: { type: "object", nullable: true }
        }
    },
    Session: {
        type: "object",
        properties: {
            id: { type: "string", example: "clx123abc" },
            name: { type: "string", example: "Marketing Bot" },
            sessionId: { type: "string", example: "marketing-1" },
            status: { type: "string", enum: ["Connected", "Disconnected", "Connecting"], example: "Connected" },
            userId: { type: "string" },
            botConfig: { type: "object", nullable: true },
            webhooks: { type: "array", items: { type: "object" }, nullable: true },
            _count: {
                type: "object",
                properties: {
                    contacts: { type: "integer" },
                    messages: { type: "integer" },
                    groups: { type: "integer" },
                    autoReplies: { type: "integer" },
                    scheduledMessages: { type: "integer" }
                },
                nullable: true
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" }
        }
    },
    Message: {
        type: "object",
        properties: {
            text: { type: "string", example: "Hello! How can I help you?" }
        }
    },
    Contact: {
        type: "object",
        properties: {
            jid: { type: "string", example: "628123456789@s.whatsapp.net" },
            name: { type: "string", example: "John Doe" },
            notify: { type: "string" },
            profilePic: { type: "string", nullable: true }
        }
    },
    ScheduledMessage: {
        type: "object",
        properties: {
            id: { type: "string" },
            sessionId: { type: "string" },
            jid: { type: "string" },
            content: { type: "string" },
            sendAt: { type: "string", format: "date-time" },
            status: { type: "string", example: "PENDING" }
        }
    },
    Webhook: {
        type: "object",
        properties: {
            id: { type: "string" },
            sessionId: { type: "string" },
            url: { type: "string" },
            events: { 
                type: "array", 
                items: { type: "string" },
                description: "Events to subscribe to: message.received, message.sent, message.status, connection.update, group.update, contact.update, status.update, group.participant, message.deleted, message.edited or '*'" 
            },
            secret: { type: "string" }
        }
    },
    WebhookLog: {
        type: "object",
        properties: {
            id: { type: "string" },
            webhookId: { type: "string" },
            event: { type: "string" },
            status: { type: "string", enum: ["SUCCESS", "FAILED"] },
            requestUrl: { type: "string" },
            requestHeaders: { type: "object" },
            requestBody: { type: "object" },
            responseStatusCode: { type: "integer", nullable: true },
            responseBody: { type: "string", nullable: true },
            responseTimeMs: { type: "integer", nullable: true },
            errorMessage: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" }
        }
    },
    Group: {
        type: "object",
        properties: {
            id: { type: "string" },
            subject: { type: "string" },
            desc: { type: "string" },
            owner: { type: "string" },
            size: { type: "number" },
            isCommunity: { type: "boolean", description: "Whether this group is a WhatsApp Community announcement group" },
            linkedParentJid: { type: "string", nullable: true, description: "JID of the parent community if this is a sub-group" },
            participants: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string" },
                        admin: { type: "string", nullable: true }
                    }
                }
            }
        }
    },
    Label: {
        type: "object",
        properties: {
            id: { type: "string" },
            name: { type: "string" },
            color: { type: "number", nullable: true },
            predefinedId: { type: "string", nullable: true }
        }
    },
    GroupDetails: {
        type: "object",
        properties: {
            id: { type: "string" },
            subject: { type: "string" },
            subjectOwner: { type: "string" },
            subjectTime: { type: "number" },
            desc: { type: "string" },
            descOwner: { type: "string" },
            descId: { type: "string" },
            owner: { type: "string" }
        }
    },
    BroadcastLog: {
        type: "object",
        properties: {
            id: { type: "string" },
            sessionId: { type: "string" },
            message: { type: "string" },
            total: { type: "integer" },
            sent: { type: "integer" },
            failed: { type: "integer" },
            status: { type: "string", enum: ["running", "completed", "cancelled"] },
            delay: { type: "integer" },
            startedAt: { type: "string", format: "date-time" },
            completedAt: { type: "string", format: "date-time", nullable: true }
        }
    },
    BroadcastRecipient: {
        type: "object",
        properties: {
            id: { type: "string" },
            jid: { type: "string" },
            status: { type: "string", enum: ["pending", "sent", "failed"] },
            error: { type: "string", nullable: true },
            sentAt: { type: "string", format: "date-time", nullable: true }
        }
    }
};
