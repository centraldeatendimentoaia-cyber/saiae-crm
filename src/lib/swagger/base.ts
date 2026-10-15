// Cabeçalho da especificação OpenAPI: descrição, servidor e esquemas de autenticação.

export const info = {
    title: "Saiaê API Documentation",
    version: "1.6.1",
    description: `
# Saiaê - Referência completa da API

Gateway profissional de WhatsApp com **mais de 100 operações** para automatizar o WhatsApp.

## 🔐 Autenticação
Todas as rotas exigem autenticação por um destes meios:
1. **Cabeçalho com chave de API**: \`X-API-Key: sua-chave-de-api\`
2. **Cookie de sessão**: \`next-auth.session-token\` (enviado automaticamente pelo navegador)

## 📋 Parâmetros comuns
- **sessionId**: identificador único da sessão (ex.: "minha-sessao-01")
- **jid**: formato de JID do WhatsApp:
  - Pessoa: \`628123456789@s.whatsapp.net\`
  - Grupo: \`120363123456789@g.us\`

## 📊 Limites
- Verificação de números: no máximo 50 por requisição
- Disparo: intervalo aleatório de 10 a 20 s entre as mensagens
- Histórico de mensagens: no máximo 100 mensagens
    `,
};

export const servers = [
    {
        url: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api",
        description: "Servidor da API",
    },
];

export const securitySchemes = {
    ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "Chave de API para autenticação"
    },
    SessionAuth: {
        type: "apiKey",
        in: "cookie",
        name: "next-auth.session-token",
        description: "Cookie de sessão (somente navegador)"
    }
};

export const security: Record<string, string[]>[] = [{ ApiKeyAuth: [] }, { SessionAuth: [] }];
