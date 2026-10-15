# Auditoria do CRM (saiae-crm)

Data: 2026-10-15. Auditoria somente leitura, feita por leitura de código. Nenhum arquivo do projeto foi alterado e nenhum commit foi feito.

Método: listagem de rotas e páginas, leitura do menu (`sidebar-nav.tsx`, `mobile-nav.tsx`), varredura automática de autenticação e validação nas rotas de API, contagem de linhas, busca de imports de dependências e histórico do git. O app não foi executado. Não existe `graphify-out/`.

## 1. Mapa do app

### Origem do código

O repositório vem de um projeto open source de gateway WhatsApp/Baileys com painel Next.js (versão 1.6.4, licença MIT). Os primeiros commits são de `mrifqidaffaaditya` (234) e `M. Rifqi Daffa Aditya` (79). O último commit do upstream é de 2026-07-12. Os demais (AiKei Bot 63, `centraldeatendimentoaia-cyber` 55, `SAIAE-APP` 52) são do projeto SAIAE. Total: 536 commits.

Por diretório, o autor dominante no git é:

- `src/modules/whatsapp` (34 arquivos): upstream (54 commits do upstream, 14 do SAIAE).
- `src/modules/ia-atendimento` (52), `agente-salao` (12), `integracao` (15), `social` (8): 100% SAIAE.
- `src/app/dashboard/redes-sociais` e `src/components/social`: SAIAE.

### Páginas (`src/app`)

Original (gateway WhatsApp): `dashboard` (painel), `sessions` (+ `[sessionId]`, `access`), `chat` (+ `[jid]`), `broadcast`, `contacts`, `groups`, `labels`, `autoreply`, `bot-settings`, `profile`, `scheduler`, `webhooks`, `sticker`, `media`, `users`, `settings`, `system-monitor`, `notifications`, `inbox`, `api-docs`, mais `docs`, `swagger`, `auth/*`, `privacy`, `terms`.

Adicionado pelo SAIAE:

- Redes Sociais: `dashboard/redes-sociais/{calendario,rascunhos,historico,contas,series}` e a rota `dashboard/social`, que só redireciona.
- IA de vendas: `dashboard/atendente-ia` (conversas da IA, só superadmin) e `dashboard/agente-ia` (configuração do agente de salão, só superadmin).
- Cobrança: `dashboard/assinatura` (Stripe).
- Outros: `dashboard/guia`, `dashboard/descadastros` (opt-out).

### API (`src/app/api`, 115 rotas)

Original: `sessions`, `chat`, `chats`, `contacts`, `groups`, `labels`, `messages` (envio, broadcast, enquete, localização etc.), `profile`, `webhooks`, `autoreplies`, `scheduler`, `notifications`, `media`, `uploads`, `users`, `settings/system`, `system/monitor`, `user/api-key`, `docs`, `auth/*`, `recipients`.

Adicionado: `social/{accounts,posts,series,signatures}`, `public-media/[token]`, `ai/copy`, `admin/ia/conversas` (+ `[id]`, `[id]/estado`), `admin/ia-vendas-conversas`, `agente/[sessionId]/config`, `integracao/comanda/v1/*` (5 rotas), `stripe/webhook`, `me/{plan,billing}`, `optouts/[sessionId]`, `whatsapp/webhook`.

### Banco (`prisma/schema.prisma`, 605 linhas, 37 modelos)

- Original: `User`, `Session`, `Contact`, `Message`, `Group`, `AutoReply`, `Story`, `ScheduledMessage`, `AuthState`, `Webhook`, `WebhookLog`, `BotConfig`, `SystemConfig`, `Label`, `ChatLabel`, `Notification`, `SessionAccess`, `BroadcastLog`, `BroadcastRecipient`, `ChatRead`, `PasswordReset`.
- Adicionado: `UsageCounter`, `SendDaily`, `StripeSubscription`, `StripeEvent`, `MediaFile`, `SocialAccount`, `ScheduledPost`, `PostSeries`, `SocialSignature`, `OptOut`, `IaConversa`, `IaMensagem`, `IaConsumo`, `IaLead`, `AgenteConfig`, `AgenteConversa`.

### Arquitetura de execução

`npm run dev` e `npm start` sobem `src/server/index.ts` (servidor customizado: Next, Socket.IO, Baileys e os crons `node-cron`, tudo no mesmo processo). Há crons em `lib/cron.ts`, `lib/retention.ts`, `modules/social/scheduler.ts` e `modules/agente-salao/followup.ts`.

## 2. Bagunça de UX e navegação

1. **Quatro itens de "Bot/IA" no menu Automação, com nomes quase iguais.** "Configurações do Bot" (`bot-settings`), "Resposta automática" (`autoreply`), "Atendente IA" (`atendente-ia`), "Agente de atendimento" (`agente-ia`) e ainda "Perfil do bot" (`profile`), todos com o mesmo ícone `Bot` nos dois da IA. Quem lê não sabe qual é o robô do Baileys, qual é a IA de vendas do Saiaê e qual é a IA do salão. `atendente-ia` é uma tela de monitoramento de conversas, `agente-ia` é configuração: nomes não dizem isso.
2. **Grupo "Automação" virou gaveta.** Contém também "Agendador", "Redes Sociais" e "Webhooks e API". Redes Sociais tem 5 subtelas e uma barra própria (`redes-sociais/layout.tsx`) e merece grupo próprio. Webhooks pertence a Desenvolvedor.
3. **Documentação da API em três lugares:** `/docs` (markdown, 107 linhas + `docs-client.tsx`), `/swagger` (Swagger UI) e `/dashboard/api-docs` (364 linhas, terceira versão). Os três se referenciam entre si ("or the Dashboard API Docs"). O menu mostra só os dois primeiros; `dashboard/api-docs` é praticamente órfã (só links cruzados de `/docs`).
4. **`dashboard/inbox` está escondida e com nome enganoso.** É a caixa de notificações internas (não tem a ver com conversas). Só abre pelo botão do sino em `navbar.tsx:169`, e não existe no menu. Enquanto isso `dashboard/notifications` (envio de notificação, superadmin) fica no menu. Duas telas "notificação/inbox" sem relação clara. A tela de conversas se chama "Conversas" (`chat`), então "inbox" confunde.
5. **Redirects mortos:** `dashboard/social/page.tsx` e `dashboard/redes-sociais/page.tsx` só redirecionam para `/calendario`. A primeira não é referenciada em lugar nenhum (0 links).
6. **Grupo "Administração" mistura papéis.** "Gerenciador de mídia", "Acesso às sessões" e "Configurações" aparecem para todos; "Usuários", "Monitor do sistema" e "Notificações" só para superadmin (`superadminOnly`). Não foi verificado se as páginas também bloqueiam por papel no servidor (ver seção 3).
7. **Menu duplicado em dois arquivos.** `sidebar-nav.tsx` e `mobile-nav.tsx` repetem a lista de itens. Qualquer item novo precisa ser adicionado em dois lugares, e já é fácil esquecer um.
8. **Mistura de idiomas.** Menu e telas novas em português, mas telas originais e mensagens de API em inglês ("Unauthorized", "User with this email already exists", "or the Dashboard API Docs"). Há mistura até na mesma frase em `docs-client.tsx:237`.
9. **Guia de uso (`dashboard/guia`, 230 linhas)** é conteúdo estático escrito à mão com listas de passos. Vai ficar desatualizado a cada feature nova; não há ligação com as telas reais.
10. **Tela "Painel" (`dashboard/page.tsx`)** não foi lida em detalhe: não foi verificado se ela mostra Redes Sociais, IA ou cobrança ou só o que veio do upstream.

## 3. Dívida técnica

### Segurança

- **Autenticação das rotas de API: boa.** O `middleware.ts` exclui `/api` do matcher, então cada rota se protege sozinha. Das 115 rotas, a varredura marcou 10 sem chamada de auth reconhecível. Todas são legítimas ou falsos positivos: `auth/*` (4 rotas de login, registro e reset, públicas por design), `docs`, `public-media/[token]` (token aleatório de 48 hex, por design), `stripe/webhook` (assinatura) e as 3 de `admin/ia/conversas*`, que usam `exigirSuperadmin` (`lib/admin-auth.ts`). `docs` e `stripe/webhook` não tiveram o código lido. As rotas `integracao/comanda/v1/*` usam assinatura HMAC por segredo (`COMANDA_CODIGO_SECRET`, `COMANDA_WEBHOOK_SECRETS`).
- **Duas formas de checar superadmin.** `admin/ia-vendas-conversas/route.ts` repete a checagem na mão em vez de usar `exigirSuperadmin`. Funciona, mas é duplicação e pode divergir.
- **`User.apiKey` guardada em texto puro** e comparada com `findUnique` (`prisma/schema.prisma:44`, `lib/api-auth.ts`). Quem lê o banco (ou um backup, `db:backup`) obtém chaves válidas. Ideal: guardar hash e mostrar a chave uma vez.
- **Mídia no banco.** `MediaFile.data` é `Bytes` (schema linha 505). Cresce o banco e os backups, e `public-media` reconverte com `sharp` a cada requisição sem cache além de `max-age=3600` (sem proteção contra abuso de CPU, mas o token é imprevisível).
- **Validação de entrada irregular.** Heurística: 46 rotas leem `req.json()` sem nenhum `zod`/`safeParse`/`validate` visível no mesmo arquivo. Há exemplos bons (`auth/register` usa zod), mas boa parte das rotas originais confia no corpo. Precisa de leitura caso a caso.
- **Registro aberto por padrão?** `auth/register` só bloqueia se `SystemConfig.enableRegistration === false`, e usa `// @ts-ignore` nessa checagem. Não foi verificado o papel e o plano dados ao novo usuário.
- **`.env.avaliacao`** existe na raiz (não está rastreado no git, o `.gitignore` parece cobri-lo). Não foi aberto; confirmar que não contém segredo reais e que não vai para a imagem Docker (`.dockerignore` existe).

### Código

- **Arquivos gigantes:** `src/lib/swagger.ts` (4331 linhas, spec escrita à mão e duplicada em `swagger.json` na raiz), `dashboard/broadcast/page.tsx` (771), `lib/webhook.ts` (724), `dashboard/scheduler/page.tsx` (684), `dashboard/webhooks/page.tsx` (641), `dashboard/labels/page.tsx` (623), `dashboard/bot-settings/page.tsx` (604), `components/dashboard/webhook-log-dialog.tsx` (581), `components/chat/chat-window.tsx` (574), `modules/whatsapp/store/index.ts` (523). A maioria é página cliente única com estado, fetch e UI misturados.
- **Dois "webhook" em `lib/`:** `webhook.ts` (724 linhas, envio dos webhooks do usuário) e `whatsapp-webhook.ts` (51 linhas, verificação de assinatura da Meta). Nomes parecidos para coisas diferentes.
- **Tipagem frouxa:** 39 usos de `@ts-ignore`/`@ts-expect-error`/`eslint-disable`, cerca de 220 `any`, 108 `console.*` (o projeto tem `lib/logger.ts`). Padrão do upstream que continuou.
- **Dependências sem uso** (nenhum import em `src/` nem `scripts/`): `@aws-sdk/client-s3`, `jimp`, `recharts`, `react-syntax-highlighter` (+ `@types/react-syntax-highlighter`), `ts-morph`, `ts-node`, `moment` (só `moment-timezone` é usado). `date-fns` e `moment-timezone` convivem (duas libs de data). `@tailwindcss/typography` é usado (`globals.css:3`). `ajv` + `zod` convivem para validação (ajv só no schema da comanda).
- **Arquivos soltos na raiz e no git:** `Dockerfile.backup`, `railway.backup.json`, `test_db.ts`, `test-media.js`, `test-message.ts`, `test-prisma.js`, `docs/api_test_output.txt`, `swagger.json`. São restos de teste manual e backups, fora do `vitest`.
- **`npm run typecheck` e `tsc --noEmit`:** o script `typecheck` usa `tsc --noEmit`; pelas suas notas do MesaAgil isso pode ser no-op se o `tsconfig` raiz usar `references`. Não foi rodado nem verificado aqui.
- **Documentação inchada e desatualizada:** `docs/` tem 20 arquivos, vários do upstream (`API_ANALYSIS_REPORT.md`, `API_DOCUMENTATION.md`, `PROJECT_DOCUMENTATION.md`, `UPDATE_GUIDE.md`) misturados com os do SAIAE (`IA_ATENDIMENTO.md`, `INTEGRACAO_COMANDA_EVENTOS.md`, `CLOUD_API_PILOTO.md`). Há também dois docs de conhecimento de vendas (`conhecimento-saiae-vendas.md`, `conhecimento-vendas-para-revisao.md`).
- **Monolito de processo único.** Next, Socket.IO, sessões Baileys e todos os crons rodam no mesmo processo (`src/server/index.ts`). Dois deploys simultâneos ou escalar para 2 instâncias duplica crons (publicação social, follow-up, retenção). Não há lock distribuído visível.
- **Testes:** 55 arquivos de teste, bem concentrados nos módulos novos (IA, comanda, cloud provider). A parte original (rotas de mensagens, grupos, labels) quase não tem teste.
- **Sobreposição de módulos de IA:** `modules/ia-atendimento` (52 arquivos, atendente de vendas/consumidor) e `modules/agente-salao` (12 arquivos, agente do salão) têm tabelas, telas, rotas e crons separados (`Ia*` vs `Agente*`). Parece haver lógica comum (histórico, estado ia/humano, pausa) que deveria ser compartilhada.

## 4. Melhorias priorizadas

| # | Impacto | Esforço | Melhoria | Onde |
|---|---------|---------|----------|------|
| 1 | Alto | Baixo (1 h) | Renomear e reagrupar o menu de IA: "Atendente IA" -> "Conversas da IA", "Agente de atendimento" -> "Agente do salão", ícones diferentes, separar o grupo "Redes Sociais" e levar "Webhooks e API" para Desenvolvedor | `src/components/dashboard/sidebar-nav.tsx`, `mobile-nav.tsx` |
| 2 | Alto | Baixo (1 h) | Fonte única do menu (array exportado) usada pela sidebar e pelo mobile | `sidebar-nav.tsx`, `mobile-nav.tsx` |
| 3 | Alto | Médio (0,5-1 dia) | Guardar `User.apiKey` com hash (mostrar a chave só na criação) e migrar as existentes | `prisma/schema.prisma:44`, `lib/api-auth.ts`, `api/user/api-key/route.ts` |
| 4 | Alto | Médio (1-2 dias) | Validar o corpo das ~46 rotas sem zod, começando por `messages`, `groups`, `webhooks`, `users`, `settings` | `src/app/api/**/route.ts` |
| 5 | Alto | Médio | Lock ou flag para crons (um só processo executa publicação social, follow-up e retenção), evitando duplicados em 2 instâncias ou durante deploy | `lib/cron.ts`, `lib/retention.ts`, `modules/social/scheduler.ts`, `modules/agente-salao/followup.ts` |
| 6 | Médio | Baixo (1 h) | Unificar a documentação da API: manter só `/swagger` (ou `/docs`), remover `dashboard/api-docs` e ajustar os links cruzados | `src/app/dashboard/api-docs/page.tsx`, `src/app/docs/*`, `rota-spam-removida.test.ts` (referencia `api-docs/page.tsx`) |
| 7 | Médio | Baixo (30 min) | Remover dependências sem uso | `package.json`: `@aws-sdk/client-s3`, `jimp`, `recharts`, `react-syntax-highlighter`, `@types/react-syntax-highlighter`, `ts-morph`, `ts-node`, `moment` |
| 8 | Médio | Baixo | Tirar do git os restos de teste e backups, ou mover para `scripts/` ou `docs/arquivo/` | `test_db.ts`, `test-media.js`, `test-message.ts`, `test-prisma.js`, `Dockerfile.backup`, `railway.backup.json`, `docs/api_test_output.txt` |
| 9 | Médio | Baixo | Renomear `dashboard/inbox` para `dashboard/notificacoes` e juntar com `dashboard/notifications` (uma tela de ver, outra de enviar, com abas) | `src/app/dashboard/inbox/page.tsx`, `notifications/page.tsx`, `navbar.tsx:169` |
| 10 | Médio | Baixo | Apagar `dashboard/social/page.tsx` (redirect sem nenhuma referência) | `src/app/dashboard/social/page.tsx` |
| 11 | Médio | Médio (1 dia) | Trocar `exigirSuperadmin` em `admin/ia-vendas-conversas` e padronizar o helper; conferir também que as páginas `superadminOnly` bloqueiam no servidor, não só escondem o item do menu | `src/app/api/admin/ia-vendas-conversas/route.ts`, `lib/admin-auth.ts`, páginas em `dashboard/users`, `system-monitor`, `notifications`, `atendente-ia`, `agente-ia` |
| 12 | Médio | Alto (3-5 dias) | Dividir páginas de 600-770 linhas em componentes e hooks (`broadcast`, `scheduler`, `webhooks`, `labels`, `bot-settings`) | `src/app/dashboard/*/page.tsx` |
| 13 | Médio | Médio | Gerar o Swagger a partir das rotas/zod em vez de 4331 linhas manuais, e apagar o `swagger.json` duplicado | `src/lib/swagger.ts`, `swagger.json` |
| 14 | Médio | Médio | Mover mídia (`MediaFile.data`) para storage externo (S3/R2) ou impor limite e limpeza; o pacote `@aws-sdk/client-s3` instalado sugere que a ideia existiu | `prisma/schema.prisma:499`, `api/uploads`, `api/public-media` |
| 15 | Baixo | Baixo | Traduzir as mensagens de API e telas restantes para pt-BR (ou definir i18n) | `api/auth/*`, `docs-client.tsx:237`, telas originais |
| 16 | Baixo | Médio | Compartilhar lógica comum entre `ia-atendimento` e `agente-salao` (estado ia/humano, pausa, histórico) | `src/modules/ia-atendimento`, `src/modules/agente-salao` |
| 17 | Baixo | Médio | Reduzir `any` e `@ts-ignore`, trocar `console.*` por `logger` | `src/**` |
| 18 | Baixo | Baixo | Arquivar os docs do upstream em `docs/upstream/` e manter um `docs/README.md` com o índice do que é do SAIAE | `docs/*` |
| 19 | Baixo | Baixo | Padronizar `date-fns` ou `moment-timezone` (uma só biblioteca de datas) | `inbox/page.tsx`, `navbar.tsx` (date-fns) vs resto (moment-timezone) |

Ordem sugerida para uma primeira passada: 1, 2, 7, 8, 10 (menos de um dia, deixa o app visivelmente mais limpo), depois 6 e 9, e só então 3, 4 e 5.

## 5. O que não foi verificado

- O app não foi executado: nenhuma tela foi aberta, então a avaliação visual (espaçamento, consistência de componentes, responsividade) não foi feita.
- `typecheck`, `lint`, `vitest` e `next build` não foram rodados.
- A varredura de auth e validação é heurística (busca de texto): pode haver falsos positivos e negativos. O resultado de "46 rotas sem validação" precisa de leitura caso a caso.
- Não foi verificado se as páginas `superadminOnly` bloqueiam também no servidor (`dashboard/layout.tsx`, `lib/server-action-auth.ts` não foram lidos).
- `src/auth.config.ts`, `dashboard/layout.tsx`, `dashboard/page.tsx` (Painel), `.env.avaliacao`, `Dockerfile`, `railway.json` e o conteúdo do `supabase/` (pasta ainda sem commit) não foram lidos.
- A lista de dependências sem uso vem de busca de imports em `src/` e `scripts/`; arquivos de configuração e plugins carregados por nome (fora de `import`) podem usar algum pacote.
- A atribuição "original x adicionado" vem do autor dos commits por pasta, não de diff completo contra o upstream.
- O bug de IDs nas conversas (outro agente, `aorus-5f`) não foi tocado nem analisado.
