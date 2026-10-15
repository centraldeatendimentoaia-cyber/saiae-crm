// Respostas de erro reutilizáveis referenciadas por #/components/responses/*.

export const responses = {
    Unauthorized: {
        description: "Unauthorized - Invalid or missing API key",
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { status: false, message: "Unauthorized", error: "Unauthorized" }
            }
        }
    },
    Forbidden: {
        description: "Forbidden - Access denied",
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }
            }
        }
    },
    NotFound: {
        description: "Resource not found",
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { status: false, message: "Session not found", error: "Session not found" }
            }
        }
    },
    SessionNotReady: {
        description: "Session not connected or ready",
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { status: false, message: "Session not ready", error: "Session not ready" }
            }
        }
    },
    BadRequest: {
        description: "Bad Request - Invalid parameters",
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { status: false, message: "Invalid request parameters", error: "Invalid request parameters" }
            }
        }
    },
    ServerError: {
        description: "Internal Server Error",
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { status: false, message: "Internal Server Error", error: "Internal Server Error" }
            }
        }
    }
};
