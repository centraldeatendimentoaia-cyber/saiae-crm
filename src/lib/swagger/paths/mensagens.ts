import { paramJid, paramMessageId, paramSessionId } from "../parametros";

export const pathsMensagens = {
    "/messages/{sessionId}/{jid}/send": {
        post: {
            tags: ["Messaging"],
            summary: "Enviar mensagem (texto, mídia ou figurinha)",
            description: "Rota universal para enviar texto, imagens, vídeos, documentos e figurinhas. Aceita menções e todos os tipos de mensagem do WhatsApp.",
            parameters: [
                {
                    name: "sessionId",
                    in: "path",
                    required: true,
                    schema: { type: "string" },
                    description: "Identificador da sessão",
                    example: "sales-01"
                },
                {
                    name: "jid",
                    in: "path",
                    required: true,
                    schema: { type: "string" },
                    description: "JID do destinatário",
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
                                    description: "Conteúdo da mensagem (texto, imagem, figurinha etc.)",
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
                                                        { type: "string", description: "URL da imagem da figurinha" },
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
                                    description: "Lista de JIDs a mencionar (em mensagens de grupo)"
                                }
                            }
                        },
                        examples: {
                            text: {
                                summary: "Mensagem de texto",
                                value: {
                                    jid: "628123456789@s.whatsapp.net",
                                    message: { text: "Hello, how can I help you?" }
                                }
                            },
                            image: {
                                summary: "Imagem com legenda",
                                value: {
                                    jid: "628123456789@s.whatsapp.net",
                                    message: {
                                        image: { url: "https://example.com/product.jpg" },
                                        caption: "New product available!"
                                    }
                                }
                            },
                            sticker: {
                                summary: "Figurinha a partir de uma URL",
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
                                summary: "Mensagem com menção",
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
                    description: "Mensagem enviada com sucesso",
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
                400: { description: "Requisição inválida: jid e message são obrigatórios" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Sessão não encontrada ou desconectada" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao enviar a mensagem" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/media": {
        post: {
            tags: ["Messaging"],
            summary: "Enviar mídia (imagem, vídeo, áudio ou documento)",
            description: "Envia um arquivo usando multipart/form-data",
            parameters: [
                {
                    name: "sessionId",
                    in: "path",
                    required: true,
                    schema: { type: "string" },
                    description: "Identificador da sessão"
                },
                {
                    name: "jid",
                    in: "path",
                    required: true,
                    schema: { type: "string" },
                    description: "JID do destinatário"
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
                    description: "Mídia enviada com sucesso",
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/Success" }
                        }
                    }
                },
                400: { description: "Requisição inválida: arquivo ausente" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao enviar a mídia" }
            }
        }
    },
    "/messages/{sessionId}/broadcast": {
        post: {
            tags: ["Messaging"],
            summary: "Disparar mensagem para vários destinatários",
            description: "Envia a mesma mensagem a vários contatos com intervalos anti-bloqueio (aleatórios, de 10 a 20 s)",
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
                                delay: { type: "number", description: "Intervalo opcional (não usado)" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Disparo iniciado",
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
                500: { description: "Falha ao iniciar o disparo" }
            }
        }
    },
    "/messages/{sessionId}/broadcast/history": {
        get: {
            tags: ["Messaging"],
            summary: "Obter o histórico de disparos",
            description: "Lista os disparos anteriores com status e contagem de enviados e falhas (guardados no banco)",
            parameters: [
                paramSessionId,
                { name: "limit", in: "query", schema: { type: "integer", default: 20 }, description: "Máximo de resultados (até 50)" },
                { name: "offset", in: "query", schema: { type: "integer", default: 0 }, description: "Deslocamento da paginação" }
            ],
            responses: {
                200: {
                    description: "Histórico de disparos",
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
            summary: "Obter o detalhe de um disparo",
            description: "Obtém o detalhe completo de um disparo, com o status de cada destinatário",
            parameters: [
                paramSessionId,
                { name: "logId", in: "path", required: true, schema: { type: "string" } }
            ],
            responses: {
                200: {
                    description: "Detalhe do disparo",
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
                404: { description: "Disparo não encontrado" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/poll": {
        post: {
            tags: ["Messaging"],
            summary: "Enviar enquete",
            description: "Cria uma enquete interativa (de 2 a 12 opções, escolha única ou múltipla)",
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
                200: { description: "Enquete enviada", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao enviar a enquete" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/location": {
        post: {
            tags: ["Messaging"],
            summary: "Enviar localização",
            description: "Compartilha coordenadas de GPS, com nome e endereço opcionais",
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
                200: { description: "Localização enviada", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao enviar a localização" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/contact": {
        post: {
            tags: ["Messaging"],
            summary: "Enviar cartão de contato",
            description: "Compartilha um ou vários cartões de contato (vCard)",
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
                200: { description: "Contato enviado", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao enviar o contato" }
            }
        }
    },
    "/messages/{sessionId}/download/{messageId}/media": {
        get: {
            tags: ["Messaging"],
            summary: "Baixar a mídia de uma mensagem",
            description: "Baixa a mídia de uma mensagem (binário direto ou redirecionamento)",
            parameters: [
                paramSessionId,
                paramMessageId
            ],
            responses: {
                200: {
                    description: "Arquivo de mídia em binário",
                    content: {
                        "*/*": { schema: { type: "string", format: "binary" } }
                    }
                },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { description: "Proibido: sem acesso à sessão ou à mensagem" },
                404: { description: "Mensagem não encontrada ou sem mídia" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/{messageId}/react": {
        post: {
            tags: ["Messaging"],
            summary: "Reagir a uma mensagem com emoji",
            description: "Adiciona uma reação com emoji a uma mensagem (texto vazio remove a reação)",
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
                                emoji: { type: "string", example: "👍", description: "Emoji, ou texto vazio para remover" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Reação enviada", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao enviar a reação" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/{messageId}/reply": {
        post: {
            tags: ["Messaging"],
            summary: "Responder a uma mensagem (citando)",
            description: "Envia uma resposta citando uma mensagem específica, pelo ID dela. Usa o mesmo formato de requisição de /send: passe um objeto de mensagem do Baileys.",
            parameters: [
                { name: "sessionId", in: "path", required: true, schema: { type: "string" }, example: "sales-01" },
                { name: "jid", in: "path", required: true, schema: { type: "string" }, example: "628123456789@s.whatsapp.net" },
                { name: "messageId", in: "path", required: true, schema: { type: "string" }, description: "ID da mensagem a responder", example: "3EB0ABCD1234567890" }
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
                                    description: "Conteúdo da mensagem, no mesmo formato de /send (texto, imagem, vídeo etc.)",
                                    example: { text: "Thanks for your message!" }
                                },
                                mentions: { type: "array", items: { type: "string" }, example: ["628123456789@s.whatsapp.net"], description: "JIDs a mencionar" },
                                fromMe: { type: "boolean", default: false, description: "Indica se a mensagem citada foi enviada por você" }
                            }
                        },
                        examples: {
                            textReply: {
                                summary: "Resposta de texto",
                                value: { message: { text: "Got it, thanks!" } }
                            },
                            imageReply: {
                                summary: "Resposta com imagem",
                                value: { message: { image: { url: "https://example.com/confirm.jpg" }, caption: "Confirmation image" } }
                            }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Resposta enviada com sucesso",
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
                400: { description: "message é obrigatório" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao enviar a resposta" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/reply": {
        post: {
            tags: ["Messaging"],
            summary: "Responder a uma mensagem (ID no corpo)",
            description: "Envia uma resposta citando uma mensagem, com o messageId no corpo da requisição. Mesmo formato de /send, mais o messageId.",
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
                                messageId: { type: "string", example: "3EB0ABCD1234567890", description: "ID da mensagem a responder" },
                                message: {
                                    type: "object",
                                    description: "Conteúdo da mensagem, no mesmo formato de /send (texto, imagem, vídeo etc.)",
                                    example: { text: "Sure, let me help you!" }
                                },
                                mentions: { type: "array", items: { type: "string" }, description: "JIDs a mencionar" },
                                fromMe: { type: "boolean", default: false, description: "Indica se a mensagem citada foi enviada por você" }
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
                    description: "Resposta enviada com sucesso",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } }
                },
                400: { description: "messageId e message são obrigatórios" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao enviar a resposta" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/{messageId}/star": {
        post: {
            tags: ["Messaging"],
            summary: "Favoritar ou desfavoritar uma mensagem",
            description: "Marca uma mensagem como favorita (salva) ou remove a marca. As favoritas aparecem na seção de mensagens favoritas.",
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
                                star: { type: "boolean", example: true, default: true, description: "true para favoritar, false para desfavoritar" },
                                fromMe: { type: "boolean", example: false, default: false, description: "Indica se a mensagem foi enviada por você" }
                            }
                        },
                        examples: {
                            star: { summary: "Favoritar mensagem", value: { star: true } },
                            unstar: { summary: "Desfavoritar mensagem", value: { star: false } }
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Favorito atualizado",
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
                500: { description: "Falha ao favoritar ou desfavoritar a mensagem" }
            }
        }
    },
    "/messages/{sessionId}/search": {
        get: {
            tags: ["Messaging"],
            summary: "Buscar mensagens",
            description: "Busca mensagens guardadas no banco para uma sessão. Aceita busca por texto e filtros por JID, tipo e remetente.",
            parameters: [
                { name: "sessionId", in: "path", required: true, schema: { type: "string" }, example: "sales-01" },
                { name: "q", in: "query", schema: { type: "string" }, example: "invoice", description: "Texto a buscar no conteúdo das mensagens" },
                { name: "jid", in: "query", schema: { type: "string" }, example: "628123456789@s.whatsapp.net", description: "Filtrar pelo JID da conversa" },
                { name: "type", in: "query", schema: { type: "string", enum: ["TEXT", "IMAGE", "VIDEO", "AUDIO", "DOCUMENT", "STICKER", "LOCATION", "CONTACT"] }, description: "Filtrar pelo tipo de mensagem" },
                { name: "fromMe", in: "query", schema: { type: "boolean" }, description: "Filtrar pelo remetente (true = enviadas, false = recebidas)" },
                { name: "page", in: "query", schema: { type: "integer", default: 1, minimum: 1 } },
                { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } }
            ],
            responses: {
                200: {
                    description: "Resultados da busca",
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
                400: { description: "q ou jid é obrigatório" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                404: { description: "Sessão não encontrada" },
                500: { description: "Falha ao buscar as mensagens" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/list": {
        post: {
            tags: ["Messaging"],
            summary: "Enviar mensagem em lista",
            description: "Envia uma mensagem em lista numerada formatada",
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
                200: { description: "Mensagem enviada", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao enviar a mensagem" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/sticker": {
        post: {
            tags: ["Messaging"],
            summary: "Enviar figurinha",
            description: "Converte uma imagem em figurinha e envia",
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
                                pack: { type: "string", description: "Nome do pacote de figurinhas (padrão: Saiaê)" },
                                author: { type: "string", description: "Nome do autor da figurinha (padrão: User)" },
                                type: { type: "string", enum: ["full", "crop", "circle"], description: "Tipo de corte da figurinha (padrão: full)" },
                                quality: { type: "integer", minimum: 1, maximum: 100, description: "Qualidade da imagem (padrão: 50)" }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Figurinha enviada", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao criar a figurinha" }
            }
        }
    },
    "/messages/{sessionId}/forward": {
        post: {
            tags: ["Messaging"],
            summary: "Encaminhar mensagem",
            description: "Encaminha uma mensagem para uma ou várias conversas",
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
                                fromJid: { type: "string", description: "JID da conversa de origem", example: "628123456789@s.whatsapp.net" },
                                messageId: { type: "string", example: "3EB0ABCD1234567890" },
                                toJids: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "JIDs dos destinatários",
                                    example: ["628987654321@s.whatsapp.net"]
                                }
                            }
                        }
                    }
                }
            },
            responses: {
                200: { description: "Mensagem encaminhada", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" } } } } } },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao encaminhar a mensagem" }
            }
        }
    },
    "/messages/{sessionId}/{jid}/{messageId}": {
        delete: {
            tags: ["Messaging"],
            summary: "Apagar a mensagem para todos",
            description: "Apaga a mensagem (só funciona para mensagens com menos de 7 minutos)",
            parameters: [
                paramSessionId,
                paramJid,
                paramMessageId
            ],
            responses: {
                200: {
                    description: "Mensagem apagada",
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
                500: { description: "Falha ao apagar a mensagem" }
            }
        },
        patch: {
            tags: ["Messaging"],
            summary: "Editar uma mensagem enviada",
            description: "Edita o texto de uma mensagem enviada",
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
                    description: "Mensagem editada",
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
                400: { description: "Requisição inválida" },
                401: { $ref: "#/components/responses/Unauthorized" },
                403: { $ref: "#/components/responses/Forbidden" },
                503: { $ref: "#/components/responses/SessionNotReady" },
                500: { description: "Falha ao editar a mensagem" }
            }
        }
    },
};
