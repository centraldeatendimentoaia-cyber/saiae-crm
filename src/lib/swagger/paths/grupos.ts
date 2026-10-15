import { paramJid, paramSessionId } from "../parametros";

export const pathsGrupos = {
    "/groups/{sessionId}/{jid}/leave": {
        "post": {
            "tags": [
                "Groups"
            ],
            "summary": "Leave a group",
            "parameters": [
                {
                    "name": "sessionId",
                    "in": "path",
                    "required": true,
                    "schema": {
                        "type": "string"
                    }
                },
                {
                    "name": "jid",
                    "in": "path",
                    "required": true,
                    "schema": {
                        "type": "string"
                    }
                }
            ],
            "responses": {
                "200": {
                    "description": "Left the group successfully"
                }
            }
        }
    },
    "/groups/{sessionId}": {
        get: {
            tags: ["Groups"],
            summary: "List all groups",
            description: "Get all groups associated with the session",
            parameters: [
                paramSessionId
            ],
            responses: {
                200: { description: "List of groups", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Group" } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { $ref: "#/components/responses/NotFound" },
                500: { description: "Failed to fetch groups" }
            }
        }
    },
    "/groups/{sessionId}/create": {
        post: {
            tags: ["Groups"],
            summary: "Create new group",
            description: "Create a new group with specified participants",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["subject", "participants"],
                            properties: {
                                subject: { type: "string", maxLength: 100, example: "VIP Customers" },
                                participants: {
                                    type: "array",
                                    items: { type: "string" },
                                    example: ["628123456789@s.whatsapp.net"]
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Group created", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, group: { $ref: "#/components/schemas/Group" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to create group" }
            }
        }
    },
    "/groups/{sessionId}/{jid}/subject": {
        put: {
            tags: ["Groups"],
            summary: "Update group subject",
            parameters: [
                paramSessionId,
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["subject"],
                            properties: {
                                subject: { type: "string", maxLength: 100 }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Subject updated", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" }, subject: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                400: { description: "Invalid subject" },
                500: { description: "Failed to update subject" }
            }
        }
    },
    "/groups/{jid}/subject": {
        put: {
            tags: ["Groups"],
            summary: "Update group name",
            description: "Update group subject (max 100 characters, requires admin)",
            parameters: [
                { name: "jid", in: "path", required: true, schema: { type: "string" }, description: "URL-encoded group JID" }
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["sessionId", "subject"],
                            properties: {
                                sessionId: { type: "string" },
                                subject: { type: "string", maxLength: 100 }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Subject updated",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    message: { type: "string", example: "Group subject updated successfully" },
                                    subject: { type: "string", example: "New Subject" }
                                }
                            }
                        }
                    }
                },
                400: { description: "Invalid request (missing fields or subject too long)" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to update group subject" }
            }
        }
    },
    "/groups/{sessionId}/{jid}/members": {
        put: {
            tags: ["Groups"],
            summary: "Manage group members",
            parameters: [
                paramSessionId,
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["action", "participants"],
                            properties: {
                                action: { type: "string", enum: ["add", "remove", "promote", "demote"] },
                                participants: { type: "array", items: { type: "string" } }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Members updated", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" }, result: { type: "array", items: { type: "object" } } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                400: { description: "Invalid action" },
                500: { description: "Failed to update members" }
            }
        }
    },
    "/groups/{sessionId}/{jid}/invite": {
        get: {
            tags: ["Groups"],
            summary: "Get invite code",
            parameters: [
                paramSessionId,
                paramJid
            ],
            responses: {
                200: { description: "Invite code", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, inviteCode: { type: "string" }, inviteUrl: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                500: { description: "Failed to get code" }
            }
        },
        put: {
            tags: ["Groups"],
            summary: "Revoke invite code",
            parameters: [
                paramSessionId,
                paramJid
            ],
            responses: {
                200: { description: "Invite revoked", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" }, newInviteCode: { type: "string" }, inviteUrl: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                500: { description: "Failed to revoke code" }
            }
        }
    },
    "/groups/{sessionId}/{jid}": {
        get: {
            tags: ["Groups"],
            summary: "Get group details",
            description: "Get detailed group information",
            parameters: [
                paramSessionId,
                paramJid
            ],
            responses: {
                200: {
                    description: "Group details",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/GroupDetails" } } }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { $ref: "#/components/responses/NotFound" },
                500: { description: "Failed to fetch details" }
            }
        }
    },
    "/groups/{jid}/leave": {
        post: {
            tags: ["Groups"],
            summary: "Leave group",
            parameters: [
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["sessionId"],
                            properties: {
                                sessionId: { type: "string" }
                            }
                        }
                    }
                }
            },
            responses: { 200: { description: "Left group" } }
        }
    },
    "/groups/{sessionId}/invite/accept": {
        post: {
            tags: ["Groups"],
            summary: "Accept group invite",
            description: "Join a group using an invite code",
            parameters: [
                paramSessionId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["inviteCode"],
                            properties: {
                                inviteCode: { type: "string" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Group invite accepted", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" }, groupJid: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                400: { description: "Invalid/Expired code" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Failed to accept invite" }
            }
        }
    },
    "/groups/{sessionId}/{jid}/picture": {
        put: {
            tags: ["Groups"],
            summary: "Update group picture",
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
                                file: { type: "string", format: "binary" }
                            }
                        }
                    }
                }
            },
            responses: { 200: { description: "Picture updated" } }
        },
        delete: {
            tags: ["Groups"],
            summary: "Remove group picture",
            parameters: [
                paramSessionId,
                paramJid
            ],
            responses: { 200: { description: "Picture removed" } }
        }
    },
    "/groups/{sessionId}/{jid}/settings": {
        put: {
            tags: ["Groups"],
            summary: "Update group settings",
            parameters: [
                paramSessionId,
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["setting"],
                            properties: {
                                setting: {
                                    type: "string",
                                    enum: ["announcement", "not_announcement", "locked", "unlocked"],
                                    description: "announcement (admins only send), not_announcement (all send), locked (admins only edit), unlocked (all edit)"
                                },
                                value: { type: "boolean", description: "Ignored but required" }
                            }
                        }
                    }
                }
            },
            responses: { 200: { description: "Settings updated" } }
        }
    },
    "/groups/{sessionId}/{jid}/description": {
        put: {
            tags: ["Groups"],
            summary: "Update group description",
            parameters: [
                paramSessionId,
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                description: { type: "string", maxLength: 512 }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Description updated", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, description: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                400: { description: "Invalid input" },
                500: { description: "Failed to update" }
            }
        }
    },
    "/groups/{sessionId}/{jid}/ephemeral": {
        put: {
            tags: ["Groups"],
            summary: "Toggle disappearing messages",
            parameters: [
                paramSessionId,
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["expiration"],
                            properties: {
                                expiration: { type: "integer", enum: [0, 86400, 604800, 7776000] }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Ephemeral toggled", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, expiration: { type: "integer" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                400: { description: "Invalid expiration" },
                500: { description: "Failed to toggle" }
            }
        }
    },
};
