// Cabeçalho da especificação OpenAPI: descrição, servidor e esquemas de autenticação.

export const info = {
    title: "Saiaê API Documentation",
    version: "1.6.1",
    description: `
# WhatsApp AI Gateway - Complete API Reference

Professional WhatsApp Gateway with **93 API endpoints** for complete WhatsApp automation.

## 🔐 Authentication
All endpoints require authentication via:
1. **API Key Header**: \`X-API-Key: your-api-key\`
2. **Session Cookie**: \`next-auth.session-token\` (automatically sent by browser)

## 📋 Common Parameters
- **sessionId**: Unique session identifier (e.g., "mysession-01")
- **jid**: WhatsApp JID format:
  - Personal: \`628123456789@s.whatsapp.net\`
  - Group: \`120363123456789@g.us\`

## 📊 Rate Limits
- Phone check: Max 50 numbers per request
- Broadcast: 10-20s random delay between messages
- Message history: Max 100 messages
    `,
};

export const servers = [
    {
        url: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api",
        description: "API Server",
    },
];

export const securitySchemes = {
    ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "API Key for authentication"
    },
    SessionAuth: {
        type: "apiKey",
        in: "cookie",
        name: "next-auth.session-token",
        description: "Session cookie (browser only)"
    }
};

export const security: Record<string, string[]>[] = [{ ApiKeyAuth: [] }, { SessionAuth: [] }];
