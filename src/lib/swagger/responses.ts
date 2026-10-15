// Respostas de erro reutilizáveis referenciadas por #/components/responses/*.

export const responses = {
    Unauthorized: {
        description: "Não autorizado: chave de API ausente ou inválida",
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { status: false, message: "Unauthorized", error: "Unauthorized" }
            }
        }
    },
    Forbidden: {
        description: "Proibido: acesso negado",
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }
            }
        }
    },
    NotFound: {
        description: "Recurso não encontrado",
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { status: false, message: "Session not found", error: "Session not found" }
            }
        }
    },
    SessionNotReady: {
        description: "Sessão não conectada ou não está pronta",
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { status: false, message: "Session not ready", error: "Session not ready" }
            }
        }
    },
    BadRequest: {
        description: "Requisição inválida: parâmetros incorretos",
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { status: false, message: "Invalid request parameters", error: "Invalid request parameters" }
            }
        }
    },
    ServerError: {
        description: "Erro interno do servidor",
        content: {
            "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                example: { status: false, message: "Internal Server Error", error: "Internal Server Error" }
            }
        }
    }
};
