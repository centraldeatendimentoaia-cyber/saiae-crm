# ChatbotX como referência de produto e de padrões

Avaliação de https://github.com/ChatbotXIO/ChatbotX, feita em 2026-11-13 apenas por leitura de páginas públicas (README, listagens de pastas e os textos dos arquivos `LICENSE`). Nada foi clonado, baixado ou copiado. O conteúdo dos arquivos de código (por exemplo os esquemas de `flow-config`) não foi lido; tudo o que se diz abaixo sobre nós e contratos vem de nomes de arquivos e do README, e deve ser tratado como indício, não como especificação.

Finalidade: servir de referência de padrões para o futuro editor de fluxos e automações do Growth OS do Sai aê. Não é dependência, fork nem fonte de código.

## 1. Licença

| Parte | Licença | Fonte |
|---|---|---|
| Repositório em geral (Community Edition) | MIT, copyright AhaChat LLC 2024-presente | `LICENSE` na raiz e README |
| `apps/builder/src/enterprise/` | Licença Comercial (Enterprise), arquivo `apps/builder/src/enterprise/LICENSE` | `LICENSE` na raiz e README |
| Componentes de terceiros | Mantêm a licença original | ambos os textos |
| Versões Enterprise e Cloud | Exigem contrato de licença separado (contato security@chatbotx.io) | `LICENSE` da pasta enterprise |

Termos essenciais da licença comercial (resumo do texto lido):

- Uso em produção exige aceitar os termos de assinatura da AhaChat LLC e ter assinatura Enterprise válida para o número correto de workspaces.
- Pode-se copiar e modificar para desenvolvimento e teste sem assinatura; a AhaChat mantém a propriedade de modificações e patches, que só podem ser usados ou distribuídos com assinatura.
- Copiar, mesclar, publicar, distribuir, sublicenciar e vender estão proibidos, salvo o que os termos permitem.
- O texto da licença deve acompanhar toda cópia ou parte substancial.

Pastas enterprise visíveis em `apps/builder/src/enterprise/features/` (a listagem pode estar incompleta): `admin-workspaces`, `audit-logs`, `billing`, `inbox-team-members`, `inbox-teams`, `manage`, `platform-admins`, `platform-audit-logs`, `platform-branding`, `platform-email-templates`, `platform-smtp`. Em resumo: administração multiempresa, cobrança, auditoria, equipes de atendimento, marca própria (white-label) e SMTP da plataforma são a parte paga.

O que isso significa na prática: o núcleo do editor e dos fluxos é MIT (reutilizável em teoria, com o aviso de copyright), mas este projeto decidiu usar o ChatbotX só como referência de ideias. Mesmo o que é MIT não será copiado.

## 2. Stack (README)

Node.js 24, TypeScript 5, pnpm 10 com workspaces e Turborepo; Next.js 16 e React 19 no builder; gateway com uWebSockets.js e Redis Streams para tempo real; Drizzle ORM com PostgreSQL e pgvector; Redis e BullMQ para filas; RustFS ou armazenamento compatível com S3; Docker Compose só para infraestrutura.

Estrutura: `apps/` (builder, worker, realtime, cli, mcp-server), `integrations/` (WhatsApp, Messenger, Instagram, Threads, Telegram, Zalo, TikTok, webchat, SMTP, OpenAI, Google Sheets e outros), `packages/` (database, ai, auth, business, automated-response, analytics, event-bus, flow-config, variables, sdk, scheduler).

Comparação com o CRM do Sai aê (Next.js, Prisma, Baileys e Cloud API do WhatsApp, `node-cron`, Railway): há alinhamento em Next.js e TypeScript; diferem ORM, fila (BullMQ e Redis versus cron com trava de job no banco) e infraestrutura. Trocar o motor de filas ou adotar Redis é uma decisão de arquitetura própria, não uma consequência desta referência.

## 3. Contratos de fluxo e nós (indícios)

Pacote `packages/flow-config/src` (nomes de itens): pastas `authoring`, `channel-rules`, `event`, `import-export`, `migrations`, `nodes`, `states`, `steps`; arquivos `definition.ts`, `publish-schema.ts`, `types.ts`, `validation-codes.ts`, `field-reference.ts`, `step-input-resolution.ts`, `template-structure.ts`, `routable-handle.ts`, `deep-link.ts`, `shared.ts`, `util.ts`.

Tipos de nó (arquivos em `nodes/`): `send-message`, `send-mail`, `condition`, `wait`, `follow-up`, `split-traffic`, `start-flow`, `perform-action`, `landing-page`, `add-notes`, `quick-reply-carrier`, mais `base` e `index`. O README fala em "15+ tipos de nó" e em nós de webhook/HTTP, agentes de IA (OpenAI, Claude, Gemini, DeepSeek e outros, com chave própria), disparos, sequências, teste A/B, automação de comentários (comentário para DM), caixa de entrada com transferência para humano, etiquetas, campos personalizados e segmentação. Há API pública, CLI e servidor MCP.

Sinais de design úteis (a validar lendo a documentação em chatbotx.io/docs, que não foi consultada):

- A definição de fluxo parece ser um documento com versão e migrações próprias (`migrations/`, `import-export/`), com esquema de publicação separado do esquema de edição (`publish-schema.ts`, `authoring/`): ou seja, rascunho de fluxo e fluxo publicado são coisas distintas.
- Códigos de validação centralizados (`validation-codes.ts`) e regras por canal (`channel-rules/`): o mesmo fluxo é validado contra as limitações de cada canal (WhatsApp, Instagram etc.).
- Referências a campos e variáveis resolvidas por módulo próprio (`field-reference`, `step-input-resolution`, pacote `variables`).
- Nós de "espera", "condição" e "divisão de tráfego" como primitivos; "iniciar outro fluxo" e "executar ação" como composição.

## 4. Editor visual

README: construtor "arrastar e soltar" de bots, gatilhos que disparam ações em eventos, nós de HTTP/webhook. Não foi inspecionada a biblioteca de grafo usada (o repositório fala de Next.js e React; não se sabe se é React Flow ou outra). Pergunta aberta para quando se aprofundar.

## 5. O que é reaproveitável por padrão (não por código)

1. Separar rascunho de fluxo de fluxo publicado, com validação na publicação, e importação/exportação versionada com migração de esquema. No CRM isso espelha o que já fazemos com rascunho e agendamento de posts.
2. Lista fechada de códigos de validação, mensagens estáveis, e regras por canal (WhatsApp Baileys, WhatsApp Cloud API, Instagram) aplicadas antes de publicar. Combina com o `parseContent` e os limites do módulo social.
3. Conjunto pequeno de nós primitivos (mensagem, condição, espera, ação, iniciar outro fluxo, divisão de tráfego, nota) em vez de um nó por caso de uso.
4. Variáveis e campos de contato resolvidos por um módulo único, com referência declarada (não texto solto).
5. Entrada humana: transferir para atendente, atribuição de conversa e etiqueta como ações de fluxo (o CRM já tem etiqueta e atendente; falta ligar a fluxo).
6. Comentário para DM no Instagram como automação clássica de crescimento (depende de aprovação e escopos da Meta; o CRM ainda tem a pendência de OAuth Meta).
7. Superfície programável: API pública, CLI e servidor MCP como cidadãos de primeira classe, o que já é a direção do `saiae-crm` MCP.
8. Modelo comercial de referência: núcleo aberto e recursos de multiempresa, cobrança, auditoria e white-label como camada paga. Serve de comparação para os módulos pagos do Sai aê.

## 6. O que NÃO pode ser incorporado

- Nenhum código, tipo, esquema, texto ou arquivo da pasta `apps/builder/src/enterprise/` (nem em desenvolvimento para uso interno em produção): a licença comercial proíbe copiar, mesclar e distribuir, e uso em produção exige assinatura Enterprise.
- Nenhuma cópia do que for Enterprise ou Cloud (cobrança, auditoria, equipes de inbox, administração de workspaces, branding, SMTP da plataforma) como funcionalidade replicada linha a linha. Reimplementar a ideia por conta própria é permitido; transcrever a implementação não é.
- Nenhum código do repositório, nem o MIT, será copiado neste projeto por decisão deste trabalho: a referência é só de padrões. Se algum dia se decidir usar trecho MIT, é preciso manter o aviso de copyright e a licença MIT, e checar se o trecho não depende de arquivos enterprise ou de componentes de terceiros com licença própria.
- Nome, marca e logotipo ChatbotX, textos de marketing, nomes de produto e identidade visual.
- Dependência direta do pacote ou do serviço Cloud como parte do Sai aê sem contrato.
- Dados, prompts e modelos de fluxo de terceiros sem confirmar licença individual.

## 7. Riscos

| Risco | Gravidade | Mitigação |
|---|---|---|
| Contaminação por licença: copiar trecho que está em pasta enterprise ou depende dela | Alta | Regra do projeto: só ideias, nunca código; ninguém abre o código enterprise para "inspirar" a implementação; registrar a fonte da ideia em doc, não em código |
| Conclusões erradas sobre contratos de fluxo por ter visto só nomes de arquivos | Média | Tratar como hipóteses; ler a documentação pública antes de decidir; prototipar com o domínio do Sai aê |
| Escopo: querer replicar uma plataforma inteira (15+ nós, 10 canais, IA, inbox) | Alta | Começar por 4 a 5 nós úteis para comanda, avisos e agenda; só então expandir |
| Troca de stack (Drizzle, Redis, uWebSockets) por imitação | Média | Manter Prisma, cron com trava e arquitetura atual até haver necessidade medida |
| Dependência de plataforma Meta (comentário para DM, escopos, revisão do app) | Média | Tratar como projeto próprio, com checklist de aprovação Meta |
| Projeto de terceiros pode mudar licença ou direção | Baixa | Referência de padrões não cria dependência |
| Mensagens automáticas em massa e conformidade (opt-out, janela de 24 h, templates) | Alta | Já existe `OptOut` e regras no CRM; manter as mesmas regras em qualquer fluxo novo |

## 8. Conclusão

Usar o ChatbotX como referência conceitual para o futuro editor de fluxos do Growth OS: separação rascunho/publicado, validação com códigos estáveis e por canal, poucos nós primitivos, variáveis resolvidas em módulo único e superfície MCP/API. Não incorporar código nem a camada Enterprise. Antes de qualquer decisão de produto baseada nele, ler a documentação oficial (chatbotx.io/docs), que não foi consultada nesta avaliação.
