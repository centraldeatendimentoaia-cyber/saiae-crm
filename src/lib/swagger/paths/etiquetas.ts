import { paramJid, paramLabelId, paramSessionId } from "../parametros";

export const pathsEtiquetas = {
    "/labels/{sessionId}": {
        "put": {
            "tags": [
                "Labels"
            ],
            "summary": "Update all labels or bulk update",
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
                    "description": "Labels updated"
                }
            }
        },
        "delete": {
            "tags": [
                "Labels"
            ],
            "summary": "Delete labels",
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
                    "description": "Labels deleted"
                }
            }
        },
        get: {
            tags: ["Labels"],
            summary: "List labels",
            description: "Get all labels with chat count",
            parameters: [
                paramSessionId
            ],
            responses: {
                200: {
                    description: "List of labels",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    labels: { type: "array", items: { $ref: "#/components/schemas/Label" } }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Session not found" }
            }
        },
        post: {
            tags: ["Labels"],
            summary: "Create label",
            description: "Create new label with color (0-19 index)",
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
                                name: { type: "string", example: "Important" },
                                color: { type: "integer", minimum: 0, maximum: 19, example: 0, description: "Color index (0-19)" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Label created",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean", example: true },
                                    label: { $ref: "#/components/schemas/Label" }
                                }
                            }
                        }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                500: { description: "Failed to create label" }
            }
        }
    },
    "/labels/{sessionId}/{labelId}": {
        put: {
            tags: ["Labels"],
            summary: "Update label",
            parameters: [
                paramSessionId,
                paramLabelId
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                name: { type: "string" },
                                color: { type: "integer", minimum: 0, maximum: 19 }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Label updated",
                    content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, label: { $ref: "#/components/schemas/Label" } } } } }
                }
            }
        },
        delete: {
            tags: ["Labels"],
            summary: "Delete label",
            parameters: [
                paramSessionId,
                paramLabelId
            ],
            responses: {
                200: {
                    description: "Label deleted",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } }
                }
            }
        }
    },
    "/labels/{sessionId}/chat/{jid}/labels": {
        get: {
            tags: ["Labels"],
            summary: "Get chat labels",
            parameters: [
                paramSessionId,
                paramJid
            ],
            responses: {
                200: {
                    description: "Chat labels",
                    content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, labels: { type: "array", items: { $ref: "#/components/schemas/Label" } } } } } }
                }
            }
        },
        put: {
            tags: ["Labels"],
            summary: "Update chat labels",
            parameters: [
                paramSessionId,
                paramJid
            ],
            requestBody: {
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            required: ["labelIds", "action"],
                            properties: {
                                labelIds: { type: "array", items: { type: "string" } },
                                action: { type: "string", enum: ["add", "remove"] }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Chat labels updated",
                    content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, message: { type: "string" }, labels: { type: "array", items: { $ref: "#/components/schemas/Label" } } } } } }
                }
            }
        }
    },
};
