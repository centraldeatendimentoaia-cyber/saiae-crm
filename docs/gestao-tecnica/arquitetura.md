# Arquitetura do Sai aê CRM (base do Growth OS)

Levantamento feito em 2026-11-13 sobre o commit `48cb963` (origem/main, o que está em produção no Railway), branch `chore/growth-os-base`. Somente leitura do código; nada foi executado contra banco ou serviços reais.

## 1. Visão geral

Aplicação única (monólito) em Next.js 16.1.1 (App Router, React 19.2.3, Tailwind 4) servida por um servidor Node customizado, que também hospeda o Socket.IO e os processos em segundo plano (workers e agendadores). Banco MySQL via Prisma 5.22. Autenticação com next-auth 5 beta. Versão do pacote: 1.6.4. Um único processo faz tudo: web, API, WebSocket, sessões WhatsApp e jobs.

Consequência importante: não existe separação entre "web" e "worker". Escalar para mais de uma instância exige os travas de job (`JobLock`, ver seção 5) e cuidado com as sessões Baileys.

## 2. Estrutura de `src/`

| Pasta | Conteúdo |
|---|---|
| `src/server/` | `index.ts` (entrada do processo) e `socket.ts` (eventos Socket.IO). |
| `src/app/` | Rotas do Next: `auth/` (login/registro), `dashboard/` (painel autenticado), `api/` (rotas REST), `docs/` e `swagger/` (documentação da API), `privacy/`, `terms/`, `error/`. |
| `src/app/api/` | Grupos: `admin`, `agente`, `ai`, `atendente`, `auth`, `autoreplies`, `chat`, `chats`, `contacts`, `groups`, `integracao` (comanda), `labels`, `me`, `media`, `messages`, `metricas`, `notifications`, `optouts`, `profile`, `public-media`, `recipients`, `scheduler`, `sessions`, `settings`, `social`, `stripe`, `system`, `uploads`, `user`, `users`, `webhooks`, `whatsapp`. |
| `src/app/dashboard/` | Telas: agente-ia, assinatura, atendente-ia, atendente-treino, autoreply, bot-settings, broadcast, chat, contacts, descadastros, groups, inbox, labels, media, metricas, notificacoes, redes-sociais, scheduler, sessions, settings, sticker, system-monitor, users, webhooks. |
| `src/components/` | Componentes React compartilhados (inclui `dashboard/nav-items`). |
| `src/landing/` | Página pública de apresentação. |
| `src/lib/` | Infraestrutura transversal: `prisma.ts`, `auth.ts`, `api-auth.ts`/`api-key.ts` (chave de API), `cron.ts` (mensagens agendadas), `job-lock.ts`, `retention.ts`, `plans.ts` e `stripe-billing.ts` (planos/cobrança), `safe-mode.ts` (cadência anti-banimento), `optout.ts`, `mailer.ts`, `media-storage.ts`, `logger.ts`, `swagger/`. |
| `src/modules/` | Domínio, detalhado na seção 4. |
| `src/proxy.ts` | Proxy/middleware do Next (autenticação, rotas públicas, restrição de páginas a SUPERADMIN). |
| `src/types/` | Tipos globais (ex.: `global.io`). |

## 3. Servidor (`src/server/index.ts`)

1. `loadEnvConfig` carrega as variáveis antes de qualquer import.
2. Aborta com erro se `AUTH_SECRET` não existir.
3. Cria `next({ dev, hostname, port })` e um `http.createServer` que delega tudo ao handler do Next. Porta: `PORT` (padrão 3030; Dockerfile define 3000).
4. Anexa `socket.io` ao mesmo servidor HTTP, caminho `/api/socket/io`, CORS `origin: "*"`. Salas: `join-session` (sala por sessão WhatsApp) e `join-user-room` (sala `user:<id>`). Instância exposta em `global.io`. Observação: as salas são entradas sem verificação de autorização no `socket.ts`; é ponto a revisar na fase de segurança.
5. Inicializa `waManager.setup(io)` e `waManager.loadSessions()` (reabre as sessões Baileys salvas).
6. Inicia três workers de fila: `iniciarWorkerAvisos` (avisos de pedido da comanda), `iniciarWorkerCampanhas` (disparos) e `iniciarWorkerAvaliacoes` (avaliação pós-entrega).
7. `keepAliveTimeout` e `headersTimeout` de 120 s (correção para o Cloudflare 520).
8. Execução em produção: `node node_modules/tsx/dist/cli.mjs src/server/index.ts`. O TypeScript do servidor roda via `tsx` em runtime (não há compilação do servidor; `tsx`, `typescript` e `prisma` são reinstalados na imagem final por isso).

## 4. Módulos (`src/modules/*`)

| Módulo | Responsabilidade |
|---|---|
| `whatsapp/` | Núcleo de mensageria. `manager.ts` e `instance.ts` gerenciam sessões Baileys; `provider/` abstrai o canal (Baileys ou Cloud API) com seleção e checagem de capacidades por rota; `cloud/` implementa a WhatsApp Cloud API oficial (cliente, inbound, janela de 24 h, status, erros); `store/` (autoreply, contatos, grupos, optout, processamento de mensagens); `bot/` (command handler, antispam); `auth/` (estado de autenticação Baileys no banco). |
| `integracao/comanda/` | Integração com o sistema de comanda (eventos de pedido), fila de avisos (`aviso-worker`). |
| `disparos/` | Campanhas de disparo em massa (`campanha`, `regras`, `worker`) e avaliação pós-entrega (`avaliacao`). |
| `agente-salao/` | Agente de atendimento para salão (motor, follow-up, transcrição de áudio, origem do lead, conhecimento). |
| `atendente/` | "Atendente" neutro configurável (motor, prompt, treino, sugestões, versões, gatilhos, migração do legado, follow-up). |
| `ia-atendimento/` | IA de atendimento e vendas (store, consumo, leads, avaliação offline via `npm run ia:avaliar`), usa Anthropic SDK. |
| `atendimento-comum/` | Utilitários comuns de atendimento (fuso `TZ_SAO_PAULO`, etc.). |
| `bot-pedidos/` | Bot de pedidos (máquina de estados). |
| `metricas/` | Cálculo e resumo de métricas (período, formato, texto de resumo). |
| `social/` | Instagram/Facebook: OAuth da Meta (`oauth.ts`), Graph (`graph.ts`), posts agendados, séries, assinaturas, criptografia de tokens (`crypto.ts`), `scheduler.ts`. |

## 5. Workers e agendadores

Todos rodam dentro do processo único:

| Job | Mecanismo | Frequência | Lock |
|---|---|---|---|
| Mensagens agendadas (`src/lib/cron.ts`) | node-cron | a cada minuto | `cron:mensagens-agendadas` |
| Retenção de dados (`src/lib/retention.ts`) | node-cron, fuso São Paulo | 03:30 diário | `cron:retencao` |
| Follow-up do agente (`agente-salao/followup.ts`) | node-cron | a cada 10 min | `cron:agente-followup` |
| Publicação social (`social/scheduler.ts`) | node-cron | a cada minuto | `cron:social-publicar` |
| Séries sociais | node-cron | minuto 7 de cada hora | `cron:social-series` |
| Avisos de pedido, campanhas, avaliações | `setInterval` | `INTERVALO_WORKER_MS` | lógica própria nos módulos |

`src/lib/job-lock.ts` implementa trava distribuída na tabela `JobLock` (com batimento e registro de presença de instância), para tolerar deploy sobreposto. Ao subir, `initScheduler` marca como `stopped` disparos `running` órfãos.

## 6. Banco e Prisma

- Provedor: `mysql`, `url = env("DATABASE_URL")`. Cliente `prisma-client-js`. Arquivo único: `prisma/schema.prisma` (cerca de 780 linhas, 49 modelos, 3 enums principais: `Role` SUPERADMIN/OWNER/STAFF, `MessageType`, `MessageStatus`, `AccessMode`).
- Não existe pasta `prisma/migrations`. O schema é aplicado por `prisma db push` (ver `plano-migracao-rollback.md`).
- Grupos de modelos:
  - Identidade e acesso: `User`, `PasswordReset`, `SessionAccess`, `SystemConfig`.
  - WhatsApp: `Session`, `AuthState`, `Contact`, `Message`, `Group`, `Story`, `ChatRead`, `Label`, `ChatLabel`, `Notification`, `OptOut`.
  - Automação: `AutoReply`, `BotConfig`, `ScheduledMessage`, `Webhook`, `WebhookLog`.
  - Disparo: `BroadcastLog`, `BroadcastRecipient`, `DisparoCampanha`, `DisparoEnvio`, `AvaliacaoPedido`, `SendDaily`, `UsageCounter`.
  - Comanda/pedidos: `BarracaSessao`, `AvisoPedido`.
  - IA: `IaConversa`, `IaMensagem`, `IaConsumo`, `IaLead`, `AgenteConfig`, `AgenteConversa`, `AtendenteTreino`, `AtendenteVersao`, `AtendenteSugestao`, `VendaIA`, `MensagemOrigem`, `ConversaOrigem`.
  - Cobrança: `StripeSubscription`, `StripeEvent`.
  - Social e mídia: `SocialAccount`, `ScheduledPost`, `PostSeries`, `SocialSignature`, `MediaFile`.
  - Infra: `JobLock`.
- 20 relações com `onDelete: Cascade` (quase todas a partir de `User` e `Session`): apagar um usuário ou sessão apaga contatos, mensagens, grupos etc. Relevante para qualquer operação de migração.
- Comentários `ATENCAO` no schema (linhas ~608 e ~732) já avisam que publicar cria tabelas em produção.

## 7. Integrações

| Integração | Onde | Observação |
|---|---|---|
| Baileys (WhatsApp Web não oficial) | `modules/whatsapp/manager.ts`, `instance.ts`, `provider/baileys.ts` | `@whiskeysockets/baileys` 7.0.0-rc.9; credenciais em `AuthState`; QR via socket. Risco de banimento mitigado por `safe-mode` e `antispam`. |
| WhatsApp Cloud API (oficial, Meta) | `modules/whatsapp/cloud/*`, `app/api/webhooks`, `app/api/whatsapp` | Webhook de entrada, janela de 24 h, templates. Docs: `docs/CLOUD_API_PILOTO.md`, `CADASTRO_CLIENTE_API_OFICIAL.md`. Teste usa `fake-meta-server.ts`. |
| Meta OAuth (Instagram/Facebook) | `modules/social/oauth.ts`, `graph.ts`, `crypto.ts` | Tokens criptografados em `SocialAccount`; publicação agendada. App Review da Meta ainda pendente (ver memória do projeto). |
| Anthropic (Claude) | `modules/ia-atendimento`, `atendente`, `agente-salao` | `@anthropic-ai/sdk`; interface `Llm` abstrai o provedor. |
| Stripe | `lib/stripe-billing.ts`, `app/api/stripe` | Assinaturas e eventos (`StripeSubscription`, `StripeEvent`). |
| Comanda (sistema do cliente) | `modules/integracao/comanda`, `app/api/integracao/comanda` | Eventos de pedido gerando avisos WhatsApp. Contrato em `docs/INTEGRACAO_COMANDA_EVENTOS.md`. |
| S3 compatível | `scripts/backup-db.js`, `@aws-sdk/client-s3` | Envio opcional do dump do MySQL. |
| SMTP | `lib/mailer.ts` | Recuperação de senha. |
| MCP `saiae-crm` | fora deste repositório | Ferramentas de leitura/rascunho sobre o CRM usadas pelo ambiente do João. |

## 8. Build, deploy e CI

- **Dockerfile** (multi-estágio, `node:24-alpine`): `npm ci --legacy-peer-deps`, `prisma generate`, `npm run build`, `npm prune --omit=dev` e reinstalação de `tsx typescript prisma@5.22.0`. Imagem final inclui `mysql-client` (usado por `scripts/backup-db.js`). Variáveis `NEXT_PUBLIC_*` são gravadas no build.
- **CMD de produção** (uma linha): `npx prisma db push && [setup-admin se ADMIN_EMAIL/ADMIN_PASSWORD] && node tsx src/server/index.ts`, com `--max-old-space-size=${NODE_MAX_MB:-512}`.
- **railway.json**: builder `DOCKERFILE`; healthcheck `/auth/login`, timeout 120 s; restart `ON_FAILURE`, 10 tentativas. `railway.backup.json` e `Dockerfile.backup` são sobras.
- **start.sh**: script para VPS com PM2 (`ecosystem.config.js`): lê `.env`, `npm install`, `npx prisma db push`, cria admin, `npm run build`, `pm2 start`. Não é usado no Railway.
- **docker-compose.yml**: MySQL 8 + app, para uso local/VPS.
- **CI** (`.github/workflows/ci.yml`): em PR e push na `main`. Job `verify`: `npm ci --legacy-peer-deps`, `prisma generate`, typecheck, testes, build (com variáveis fictícias). Job `lint`: informativo (`continue-on-error`), por causa de erros antigos. Não há job de deploy no GitHub; o Railway faz deploy pelo próprio build do Dockerfile.
- **Backup**: `npm run db:backup` (mysqldump + gzip + rotação + S3); em produção seria um serviço Railway com cron separado (confirmar se existe).

## 9. Pontos de atenção arquiteturais

1. `prisma db push` em todo start com schema direto em produção (seção dedicada no plano de migração).
2. Processo único com Baileys, workers e web: reiniciar o web derruba sessões WhatsApp e reconecta tudo.
3. Socket.IO com CORS `*` e salas sem checagem de dono.
4. Servidor TypeScript executado por `tsx` em runtime (sem build do servidor), imagem maior e partida mais lenta.
5. Dependências de pré-release: `next-auth` 5 beta, Baileys 7 rc.
6. `npm ci` local sem `--legacy-peer-deps` funcionou; o Dockerfile e o CI usam a flag. Convém decidir uma política única.
