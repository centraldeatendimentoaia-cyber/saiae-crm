# Revalidação de achados de auditoria (Sai aê Growth OS)

Revisão somente leitura do worktree `D:\Projetos\_saiae\saiae-crm-growth`, commit `48cb963`. Nada foi executado contra serviços externos nem alterado no código. Caminhos abaixo são relativos à raiz do worktree, linhas referem-se a este commit. O conector MCP `saiae-crm` fica fora do repositório (`D:\escritorio\server\connectors\saiae-crm\`) e foi só lido.

## Resumo

| # | Achado | Status | Severidade |
|---|--------|--------|-----------|
| 1 | Redirect OAuth Meta cai em localhost | PARCIAL | Média |
| 2 | Socket.IO sem autorização | CONFIRMADO | Crítica |
| 3 | Mídia sem checar dono/empresa | JÁ CORRIGIDO (resíduos baixos) | Baixa |
| 4 | WhatsApp: recuperação de falhas incompleta | PARCIAL | Média |
| 5 | Agendamentos recorrentes perdem ocorrências | PARCIAL | Média |
| 6 | Concorrência/duplicação em broadcasts | PARCIAL (worker de disparos OK; envio manual e avisos com furos) | Média |
| 7 | Primeira sessão Cloud implícita | CONFIRMADO | Alta (se houver mais de 1 loja na Cloud API) |
| 8 | Aprovação editorial sem bloqueio de reprovadas | CONFIRMADO (não existe estado de aprovação no CRM) | Média |
| 9 | Ausência de integração agência–CRM | CONFIRMADO (só há pontos de entrada genéricos) | Informativa |
| 10 | Isolamento multiempresa | PARCIAL (modelo por usuário, sem id de empresa) | Média |

Modelo de tenant real: não existe tabela de empresa. O "dono" é `User` (`Session.userId`), mais `SessionAccess` (acesso compartilhado a uma sessão) e `BarracaSessao.barracaId` (loja da Comanda, texto sem relação). Toda checagem de rota passa por `canAccessSession` (`src/lib/api-auth.ts:92-128`).

---

## 1. OAuth Meta caindo em localhost — PARCIAL

Evidência:
- `src/modules/social/oauth.ts:21-24`: `urlDeRetorno(origin)` usa `BASE_URL || NEXTAUTH_URL || origin`. O `redirect_uri` enviado à Meta e o do `trocarCodigoPorToken` está certo quando uma das variáveis existe.
- `src/app/api/social/oauth/callback/route.ts:12-13`: `const origin = request.nextUrl.origin; const voltar = (qs) => NextResponse.redirect(new URL(..., origin))`. Todos os redirects de volta ao painel (ok, erro, negado, nao-configurado) usam `nextUrl.origin` e ignoram `BASE_URL`.
- `src/app/api/social/oauth/start/route.ts:13`: o redirect de "não configurado" também usa `nextUrl.origin`.
- Servidor customizado: `src/server/index.ts:18,25` faz `next({ hostname })` com `HOSTNAME` (Dockerfile:41 define `0.0.0.0`; padrão do código é `localhost`). Atrás do proxy do Railway, `nextUrl.origin` pode vir como `http://localhost:PORT` ou `0.0.0.0`, e o navegador do usuário é mandado para lá após conectar.
- Sem `BASE_URL`/`NEXTAUTH_URL`, `redirect_uri` também cai em `origin` (mesmo problema, e a Meta recusa por URI não cadastrada).
- Resíduo relacionado: `src/modules/social/scheduler.ts:9` `publicMediaUrl` usa só `BASE_URL`, vazio gera URL relativa e a Meta não baixa a imagem. `src/lib/stripe-billing.ts:129` tem fallback literal `http://localhost:3000`.

Causa comprovada: dois pontos (callback e start) montam a URL final pelo `origin` da requisição, não pela base configurada.

Menor correção: criar uma função única `baseUrl(request)` (`BASE_URL || NEXTAUTH_URL || origin`, sem barra final) em `src/modules/social/oauth.ts` e usá-la em `voltar`, no redirect do `start` e no `urlDeRetorno`. Falhar com erro claro em produção se nenhuma variável estiver definida. Aplicar a mesma base em `publicMediaUrl`.

Arquivos: `src/modules/social/oauth.ts`, `src/app/api/social/oauth/callback/route.ts`, `src/app/api/social/oauth/start/route.ts`, `src/modules/social/scheduler.ts`. Testes: estender `src/modules/social/oauth.test.ts` (base configurada vence o origin; sem variável usa origin).

---

## 2. Socket.IO sem autorização — CONFIRMADO (crítico)

Evidência:
- `src/server/index.ts:42-49`: `new Server(server, { path: "/api/socket/io", cors: { origin: "*" } })`. Sem `io.use`, sem checagem de cookie/token no handshake. O Socket.IO atende esse caminho direto no servidor HTTP, antes do handler do Next; portanto o `src/proxy.ts` não protege o socket.
- `src/server/socket.ts:13-16`: `join-session` faz `socket.join(sessionId)` com qualquer string do cliente, sem `canAccessSession`.
- `src/server/socket.ts:19-22`: `join-user-room` faz `socket.join("user:" + userId)` com o id que o cliente mandar.
- Eventos emitidos para essas salas: `connection.update` com o QR em texto (`src/modules/whatsapp/instance.ts:190`, 207, 234, 254, 272, 296, 361; `manager.ts:121`), `message.upsert` e `message.update` com conteúdo das mensagens (`src/modules/whatsapp/store/index.ts:41,88`; `store/process-message.ts:109`), `broadcast.progress` com JIDs e erros (`src/app/api/messages/[sessionId]/broadcast/route.ts:109,222,274`), `notification:new` (`src/app/api/notifications/route.ts:67,95`).
- O `sessionId` é escolhido pelo usuário (`src/app/api/sessions/route.ts:11`, ex.: `marketing-1`), logo adivinhável. Quem entra na sala vê o QR (pode vincular o WhatsApp do cliente ao aparelho do atacante) e as mensagens em tempo real.
- Clientes: `src/components/chat/socket-context.tsx:52`, `src/app/dashboard/sessions/[sessionId]/page.tsx:104`, `src/components/dashboard/navbar.tsx:66`.

Causa comprovada: nenhuma autenticação no handshake e nenhuma autorização nos joins.

Menor correção:
1. `io.use` em `src/server/socket.ts` que decodifica o JWT do cookie de sessão do Auth.js (`next-auth/jwt` `getToken` com `AUTH_SECRET`; o cookie vai junto por ser mesma origem) e grava `socket.data.userId/role`; sem token, recusa.
2. `join-session`: `await canAccessSession(userId, role, sessionId)` antes de entrar.
3. `join-user-room`: ignorar o argumento e entrar só em `user:${socket.data.userId}`.
4. `cors.origin` restrito a `BASE_URL`.

Arquivos: `src/server/socket.ts`, `src/server/index.ts`. Testes novos: `src/server/socket.test.ts` (sem cookie recusa, join de sessão alheia ignorado, sala de outro usuário ignorada).

---

## 3. Acesso a mídia sem checar dono — JÁ CORRIGIDO (resíduos baixos)

Evidência do fechamento:
- `src/app/api/media/[filename]/route.ts:33-49`: exige usuário e `canAccessSession` sobre o `sessionId` extraído do nome; nome fora do padrão só o SUPERADMIN abre; bloqueia `..` e barras e confere caminho resolvido dentro de `data/media`.
- `src/app/api/media/route.ts`: lista só sessões do usuário (linhas 39-49) e o DELETE repete a checagem (linhas 183-190).
- `src/app/api/uploads/[id]/route.ts:10-12`: só o dono ou SUPERADMIN.
- `src/app/api/uploads/route.ts:24-28`: com `sessionId` exige `canAccessSession`; dono vira o da sessão.
- `src/app/api/messages/[sessionId]/download/[messageId]/media/route.ts`: confere acesso à sessão e que a mensagem pertence à sessão (linhas 17-40) e ancora o caminho (linha 55).
- `src/app/api/public-media/[token]/route.ts`: pública de propósito (a Meta baixa); token aleatório de 48 hex (`^[a-f0-9]{48}$`).
- Não há S3 em uso: `@aws-sdk/client-s3` consta no `package.json:23`, mas `src/lib/media-storage.ts` só tem `DbMediaStorage` (bytes no Postgres).

Resíduos (baixos):
- A propriedade de arquivo em disco é inferida do prefixo do nome (`{sessionId}-{keyId}`), não de uma tabela. Funciona porque o `keyId` não contém hífen no uso atual; `sessionId` é livre (até 100 caracteres) e pode conter hífen. Ex.: sessões `a` e `a-b` não colidem hoje, mas a regra é frágil.
- `GET /api/media` faz a consulta de mensagens por `keyId` sem filtrar sessão (`route.ts:81-85`), só usa depois pelo mapa; sem vazamento, apenas trabalho extra.

Menor correção (opcional): filtrar `message.findMany` por `session.sessionId in (sessões do usuário)`. Testes: já há `src/lib/media-storage.test.ts`, `media-retention.test.ts`; adicionar teste de rota para 403 com sessão alheia.

---

## 4. WhatsApp: recuperação de falhas incompleta — PARCIAL

Já bom:
- Worker de disparos (`src/modules/disparos/worker.ts`): reserva atômica, retentativa com espera crescente (`:25-26`), estados finais claros, validade, janela horária, cancelamento respeitado.
- Social: post em `PUBLISHING` interrompido vira `FAILED` com aviso de "pode já ter saído" (`src/modules/social/scheduler.ts:77-92`), tratamento explícito de resultado desconhecido.

Lacunas:
- Resultado desconhecido no envio WhatsApp: se o envio ocorreu e a gravação do estado `enviado` falha (`worker.ts:210`, `aviso-worker.ts:157`), a reserva expira (5 min / 60 s) e o item é reenviado. Timeout/erro de rede é tratado como falha comum e entra em retentativa, podendo duplicar (`src/modules/whatsapp/cloud/client.ts:70-82` converte timeout em erro `network` sem distinguir "não saiu" de "talvez saiu").
- Mensagens agendadas (`src/lib/cron.ts:67-143`): não há claim antes do envio; envia, depois atualiza. Queda entre os dois = reenvio. Erro de envio em mensagem única marca `FAILED` na primeira falha, sem retentativa e sem motivo gravado (só log). Sessão desconectada deixa `PENDING` sem limite de validade (cron.ts:51-57): ao reconectar dias depois sai texto velho.
- Notificador de pedido (Cloud API): `src/modules/integracao/comanda/order-notifier.ts:116-130` não propaga nem reenfileira falha ("aviso é secundário"); o dedupe `deps.sent` é em memória (`BoundedTtlMap`), perdido no reinício. Status `failed` da Meta só vira linha de log (`src/app/api/whatsapp/webhook/route.ts:98`), sem reação.
- Envio manual por lote (`broadcast/route.ts:127-293`): se o processo reinicia, `initScheduler` marca o log `stopped` (`cron.ts:25-29`), mas os destinatários seguem `pending` sem retomada nem relatório do que faltou. Falhas não são reprocessadas.

Menor correção, em ordem de custo:
1. `aviso-worker.ts`/`worker.ts`: gravar `estado="enviando"` com id da mensagem antes de chamar `sendText` e, ao reservar um item que já estava `enviando`, marcar `falhou/resultado_desconhecido` em vez de reenviar (mesmo princípio do social).
2. `cron.ts`: claim `updateMany(PENDING→SENDING)` antes do envio, gravar `error`/motivo na falha e ignorar mensagens não recorrentes vencidas há mais de X horas.
3. Mapear `CloudApiError` `network` como "desconhecido" no notificador, sem retentar texto livre.

Arquivos: `src/lib/cron.ts`, `src/modules/disparos/worker.ts`, `src/modules/integracao/comanda/aviso-worker.ts`, `order-notifier.ts`, `broadcast/route.ts`. Testes: `cron.test.ts`, `worker.test.ts`, `aviso-worker.test.ts`, `order-notifier.test.ts` (já existem; acrescentar casos de queda após envio).

---

## 5. Agendamentos recorrentes que perdem ocorrências — PARCIAL

Mensagens recorrentes (`src/lib/cron.ts`):
- A próxima data é calculada a partir de `agora` (`cronParser.parse(...).next()` sem `currentDate`), não de `msg.sendAt`. Se o servidor ficou fora ou a sessão desconectada por vários ciclos, só uma ocorrência sai (a atrasada) e as intermediárias são descartadas em silêncio.
- Erro de envio em recorrente avança para a próxima data sem registrar falha (`cron.ts:129-136`); bloqueio de plano idem (`:80-85`). A ocorrência some sem aviso ao usuário.
- Sem claim: reinício entre envio e `update` repete a ocorrência (ver item 4).
- Travas: ciclo protegido por `running` local e `withJobLock("cron:mensagens-agendadas", 10 min)` (`cron.ts:146`; `src/lib/job-lock.ts`). Boa; o ciclo usa `sleep` de 2,5 a 6 s entre mensagens, então um lote grande passa de 1 minuto e os ciclos seguintes simplesmente são pulados (sem perda, só atraso).

Posts sociais e séries (`src/modules/social/scheduler.ts`, `series.ts`):
- Claim `PENDING→PUBLISHING` atômico (`scheduler.ts:15-16`) e geração de série com claim por `generatedCount` dentro de transação (`series.ts:178-188`): sem duplicação. Séries geram horizonte de 56 dias e rodam na subida e de hora em hora (`scheduler.ts:104-106`), então reinício não perde ocorrências futuras.
- Sem conta viva, a série vira `ENDED` em silêncio e as ocorrências futuras deixam de ser geradas (`series.ts:140-143`), sem notificação.
- Ao reiniciar com outra instância viva, posts `PUBLISHING` são marcados `FAILED` pelo critério `publishAt < agora-15min` (`scheduler.ts:93`), que usa a data planejada e não a do claim: um post atrasado que a outra instância acabou de pegar pode ser marcado como falho. Raro.
- Post vencido por muito tempo (servidor parado por dias) é publicado tarde, sem limite de validade.
- `publicMediaUrl` sem `BASE_URL` gera URL relativa (ver item 1).

Menor correção: em `cron.ts` calcular `next` com `currentDate: new Date(Math.max(msg.sendAt, now))` e, ao avançar por erro ou plano, gravar `lastError`/notificação; em `series.ts` criar `Notification` quando encerrar por falta de conta; usar timestamp de claim (novo campo ou `updatedAt`) no critério dos 15 min. Testes: `src/lib/cron.test.ts`, `src/modules/social/series.test.ts`, `social.test.ts`.

---

## 6. Concorrência/duplicação em broadcasts — PARCIAL

OK:
- Worker de campanhas: reserva `updateMany` condicional com relógio atual por item (`worker.ts:259-264`), finalização condicional em `pendente` (não sobrescreve cancelamento, `:92-94`), limite de 1 mensagem por cliente em 24 h.
- Social e séries: ver item 5.

Furos:
- Aviso-worker: a reserva usa `agora` capturado no início do ciclo (`aviso-worker.ts:179,188-190`), com lote de 20 envios, cada um com pausa de 1 a 3 s mais o tempo de envio, e `RESERVA_MS` de só 60 s. Itens do fim do lote correm risco de a reserva vencer antes de terminarem e outro worker (segunda instância) pegar o mesmo aviso. O worker de campanhas já corrigiu isso (`const t = deps.now()`); o de avisos não. `finalizar`/`adiar` também usam `update` sem condição (`:89-95`), ao contrário do de campanhas.
- Disparo manual (`broadcast/route.ts`): trava `running` é um `Map` em memória por processo (`:16`), vale só para uma instância. O `running.set` acontece depois de vários `await` (`:83-125`), então duas chamadas simultâneas passam do `has` e ambas iniciam. A proteção contra duplicata de 12 h consulta o banco antes do envio, sem unicidade (`:170-179`), logo é check-then-act.
- Tetos por número (`worker.ts:156-174`, `aviso-worker.ts:124-137`) são contados antes do envio, sem trava: dois workers simultâneos podem passar do teto por alguns itens. Efeito pequeno.
- `broadcast/cancel` muda o log por `sessionId` (`cancel/route.ts:12`), correto.

Menor correção: no aviso-worker usar `deps.now()` por item e `RESERVA_MS` maior que `LOTE × (jitter + timeout)`, e trocar `update` por `updateMany({ where: { id, estado: "pendente" } })`. No broadcast manual, criar o log e o claim em uma só operação atômica (índice único parcial por `sessionId` com `status="running"`, ou `withJobLock("broadcast:"+sessionId)`). Testes: `aviso-worker.test.ts`, `broadcast/route.test.ts`, `worker.test.ts`.

---

## 7. Seleção implícita da primeira sessão Cloud — CONFIRMADO

Evidência (três pontos usam `[...cloudSessionIds(env)][0]`):
- `src/modules/ia-atendimento/consumer.ts:228` (sessão usada ao tratar todo o lote recebido).
- `src/modules/ia-atendimento/registro.ts:27` (provider de envio da IA).
- `src/modules/integracao/comanda/order-notifier.ts:103` (avisos de pedido; o comentário diz "Piloto: 1 número").
- Credenciais da Cloud API são globais por variável de ambiente (`src/modules/whatsapp/cloud/config.ts`: um `META_WA_PHONE_NUMBER_ID`, um token), e `getProvider` (`provider/index.ts:51-55`) devolve o mesmo provedor para toda sessão listada em `WHATSAPP_CLOUD_SESSION_ID`.
- O webhook (`src/app/api/whatsapp/webhook/route.ts`) entrega o lote com `phoneNumberId` (campo normalizado em `cloud/inbound.ts:52,219`), mas o consumidor ignora esse campo.

Impacto: com duas lojas na Cloud API, toda mensagem recebida e todo aviso saem pela primeira sessão listada e pelo número único das variáveis. Hoje é piloto de 1 número, então o risco é latente, mas bloqueia multiempresa.

Menor correção: tabela/mapa `phoneNumberId → sessionId (+ token)` (pode ser variável JSON no piloto) e resolver a sessão por `batch.events[].phoneNumberId` no consumidor; no notificador resolver pela `barraca_id` via `BarracaSessao`. Recusar (log) quando não houver mapeamento, em vez de cair na primeira. Arquivos: os três acima, `cloud/config.ts`, `provider/index.ts`. Testes: `consumer` e `order-notifier.test.ts`, `provider/select.test.ts`.

---

## 8. Aprovação editorial sem bloqueio de reprovadas — CONFIRMADO

Evidência:
- O CRM não tem conceito de aprovação/reprovação de peça. Estados de `ScheduledPost`: `DRAFT | PENDING | PAUSED | PUBLISHING | PUBLISHED | FAILED` (`prisma/schema.prisma:548`). Não existe `APPROVED`/`REJECTED` nem campo de revisor.
- `POST /api/social/posts` (`src/app/api/social/posts/route.ts:96-103`) cria direto `PENDING` (publica no horário) quando `draft` não é `true`.
- `PATCH /api/social/posts/:id` (`[id]/route.ts:70-76`): enviar `publishAt` transforma qualquer rascunho em `PENDING`, sem checar quem pediu nem aprovação.
- Qualquer chave de API do usuário dono pode fazer as duas coisas.
- O bloqueio de reprovadas existe só fora do CRM: o escritório (`D:\escritorio\server\connectors\saiae-crm\office-api.mjs`, `crm.mjs`) cria só rascunhos pelo MCP e só agenda após o clique de aprovação; `crm-check.mjs` testa que recusar não executa. O CRM não impõe isso: quem tiver a chave pode agendar e disparar direto (`crm.mjs` chama `POST /broadcast` e `PATCH publishAt` com a mesma chave).

Menor correção: adicionar `approvalStatus` (`NONE|APPROVED|REJECTED`) em `ScheduledPost` e, no `publishOne` e no `PATCH`, recusar `REJECTED`; para exigir aprovação, só aceitar chave de API com escopo "aprovador" para sair de rascunho. Arquivos: `prisma/schema.prisma`, `src/app/api/social/posts/route.ts`, `[id]/route.ts`, `src/modules/social/scheduler.ts`. Testes: `src/modules/social/social.test.ts`.

---

## 9. Integração agência–CRM — CONFIRMADO (ausente)

Pontos de entrada existentes (nenhum específico da agência):
- API de posts: `GET/POST /api/social/posts`, `PATCH/DELETE /api/social/posts/:id`, séries `/api/social/series`, contas `/api/social/accounts`, uploads de imagem `POST /api/uploads` (a imagem precisa existir como `MediaFile` para o post).
- Autenticação por chave: header `x-api-key`, validada por hash SHA-256 (`src/lib/api-auth.ts:20-44`, `src/lib/api-key.ts`), emitida em `/api/user/api-key`; sempre escopada ao `userId` da chave.
- MCP `saiae-crm` (fora do repo): 11 ferramentas (buscar/ver contatos, etiquetas, campanhas, contas sociais, posts agendados, métricas, `rascunho_post_instagram`, `rascunho_campanha`, `solicitar_envio`) falando com o CRM por `x-api-key` e com a API do escritório para aprovações (`crm.mjs`, `tools.mjs`).
- Não existe rota para a agência entregar um pacote (CSV/PNG/legenda de `D:\agencia-marketing`), nem campo de cliente/slug/semana em `ScheduledPost`, nem importador do `plano.json`. O formato dos pacotes está em `docs/gestao-tecnica/agencia-pacote-formato.md`: arquivos em disco, sem API.
- Lead de vendas: só o modelo `IaLead` (`prisma/schema.prisma:657`), alimentado pela IA, sem rota de entrada externa.

Menor caminho para integrar: um endpoint (`POST /api/social/pacotes`, por chave de API) que recebe o pacote, grava imagens em `MediaFile`, cria `ScheduledPost` como `DRAFT` com `groupId` = semana/slug, deixando o agendamento para o item 8.

---

## 10. Isolamento multiempresa — PARCIAL

Modelo de dados (`prisma/schema.prisma`): não há `empresaId`/`tenantId`. O isolamento é por `User` e por `Session`.

| Modelo | Chave de isolamento |
|---|---|
| Session | `userId` (dono) |
| SessionAccess | `sessionId` + `userId` (compartilhamento) |
| Contact, Message, Group, AutoReply, Story, ScheduledMessage, AuthState, Label, ChatRead | `sessionId` (cuid de Session) |
| BotConfig | `sessionId` único |
| Webhook | `userId` e `sessionId?` (nulo = todas as sessões do usuário) |
| BroadcastLog, BroadcastRecipient, OptOut, SendDaily | `sessionId` como texto (o id Baileys, sem relação Prisma) |
| MediaFile, SocialAccount, ScheduledPost, PostSeries, SocialSignature, Notification, UsageCounter, StripeSubscription, PasswordReset | `userId` |
| AgenteConfig, AgenteConversa, MensagemOrigem, ConversaOrigem, AtendenteTreino, AtendenteVersao, AtendenteSugestao, VendaIA | `sessionId` texto (Baileys), sem relação Prisma |
| BarracaSessao, AvisoPedido, DisparoCampanha, DisparoEnvio, AvaliacaoPedido | `barracaId` (texto, loja da Comanda) |
| IaConversa, IaMensagem, IaConsumo, IaLead | sem tenant (`contactKey` global; IA só em uma loja de piloto) |
| SystemConfig, StripeEvent, JobLock | globais, de propósito |

Riscos:
- Sem relação Prisma em várias tabelas (`sessionId`/`barracaId` em texto): não há integridade referencial nem cascata ao apagar sessão.
- `IaLead`/`IaConversa` são globais, coerente com o piloto único (item 7).
- `sessionId` é escolhido pelo usuário e único no sistema (`Session.sessionId @unique`), o que permite "reservar" um nome antes de outro cliente.
- Papel `STAFF` e `OWNER` têm o mesmo alcance sobre as sessões a que têm acesso; `SessionAccess` concede acesso total, sem nível leitura.

Rotas: as por `[sessionId]` chamam `canAccessSession` (conferido em todas as rotas listadas abaixo) e as que recebem um id filho confirmam que o filho pertence à sessão da URL (autoreplies, labels, scheduler, histórico de broadcast, webhooks). Rotas sociais filtram por `userId`. Não encontrei IDOR direto. Pontos que merecem atenção:
- `src/app/api/autoreplies/[sessionId]/[replyId]/route.ts:48,85,98` e `scheduler/[sessionId]/[scheduleId]/route.ts:49,63,100,113`: depois de validar o dono, o `update/delete` é por `id` solto (sem repetir o filtro de sessão), vulnerável apenas a corrida; não explorável hoje.
- `src/app/api/messages/[sessionId]/broadcast/cancel/route.ts:12` cancela por `sessionId` do texto da URL (pode ser o cuid ou o nome); se vier o cuid, não casa com `BroadcastLog.sessionId` (nome Baileys) e o cancelamento falha em silêncio. Verificar qual valor o painel envia.
- Socket.IO fura todo o isolamento em tempo real (item 2).

Menor correção: manter o modelo por usuário (suficiente para hoje), corrigir o item 2 e documentar. Para multiempresa de verdade: `Empresa` + `empresaId` em `User/Session` e checagem única em `canAccessSession`.

---

## Inventário de rotas `src/app/api/**` (route.ts)

Legenda de auth:
- Sessão ou chave: `getAuthenticatedUser(request)` (cookie de sessão ou `x-api-key`) mais, quando aplicável, `canAccessSession`.
- Superadmin: exige `role === SUPERADMIN`.
- Webhook/HMAC: pública no `src/proxy.ts`, validada na rota por assinatura.

Observação importante sobre o proxy (`src/proxy.ts:46-52`): qualquer requisição `/api/*` com header `x-api-key` (de qualquer valor) passa direto pelo proxy; a validação fica a cargo de cada rota. Rota sem checagem própria fica exposta com um header falso. Hoje só `GET /api/docs` está nesse caso.

| Rota(s) | Auth |
|---|---|
| `auth/[...nextauth]`, `auth/register`, `auth/forgot-password`, `auth/reset-password` | NENHUMA (públicas por desenho: login e cadastro; register respeita `enableRegistration`) |
| `docs` (OpenAPI) | NENHUMA na rota; o proxy exige sessão, mas basta mandar `x-api-key: x` para ler a especificação. Baixo risco (documentação) |
| `public-media/[token]` | NENHUMA, por token de 48 hex (necessário para a Meta baixar) |
| `whatsapp/webhook` | Webhook: token de verificação (GET) e HMAC `x-hub-signature-256` (POST) |
| `stripe/webhook` | Webhook: assinatura Stripe (`verifyStripeSignature`) |
| `integracao/comanda/v1/eventos`, `codigo-verificacao`, `ia-consumo`, `ia-dono-pedir-confirmacao`, `ia-apagar-conversas`, `whatsapp-conexao`, `whatsapp-disparos` | Webhook/HMAC por barraca ou segredo de plataforma, janela de 5 min (`src/modules/integracao/comanda/signature.ts`) |
| `admin/ia-vendas-conversas`, `admin/ia/conversas`, `admin/ia/conversas/[id]`, `.../[id]/estado` | Superadmin |
| `atendente/[sessionId]/publicar`, `reproduzir`, `reverter`, `sugestoes`, `teste`, `treino` | Superadmin e `canAccessSession` (`guardAtendente`) |
| `agente/[sessionId]/config` | Sessão ou chave com `canAccessSession`; trechos só para superadmin |
| `users`, `users/[id]` | Superadmin |
| `settings/system` | Sessão ou chave; escrita só superadmin |
| `system/monitor` | Superadmin; `system/monitor/[sessionId]` sessão ou chave com `canAccessSession` |
| `notifications` (GET/POST), `notifications/read`, `notifications/delete` | Só sessão (`auth()`), chave de API não vale; POST só superadmin |
| `user/api-key` | Só sessão (`auth()`) |
| `me/billing`, `me/plan` | Sessão ou chave |
| `ai/copy` | Sessão ou chave |
| `sessions`, `sessions/[sessionId]` (+ `[action]`, `qr`, `bot-config`, `settings`) | Sessão ou chave com `canAccessSession` (settings com `isAdmin` em trechos) |
| `sessions/[sessionId]/access` | Sessão ou chave, `isSessionOwner` |
| `chat/[sessionId]/**` (check, archive, mute, pin, presence, profile-picture, read, `[jid]`) | Sessão ou chave com `canAccessSession` |
| `chats/[sessionId]/by-label/[labelId]` | idem |
| `contacts/[sessionId]` (+ export, `[jid]/block`, `unblock`) | idem |
| `groups/[sessionId]/**` (create, invite/accept, `[jid]` e description, ephemeral, invite, leave, members, picture, settings, subject) | idem |
| `labels/[sessionId]/**` | idem |
| `messages/[sessionId]/**` (send, reply, media, poll, list, location, contact, sticker, template, `[messageId]` e react/reply/star, forward, search, download media, broadcast, broadcast/cancel, broadcast/history e `[logId]`) | idem |
| `autoreplies/[sessionId]` e `[replyId]` | idem |
| `scheduler/[sessionId]` e `[scheduleId]` | idem |
| `profile/[sessionId]` (name, picture, status) | idem |
| `webhooks/[sessionId]` e `[id]` (logs, test) | idem |
| `optouts/[sessionId]`, `recipients/[sessionId]`, `metricas/[sessionId]` | idem |
| `media`, `media/[filename]` | Sessão ou chave; checa `canAccessSession` pelo prefixo do arquivo (item 3) |
| `uploads`, `uploads/[id]` | Sessão ou chave; só o dono (ou superadmin) |
| `social/accounts` (+ `[id]`, `[id]/status`), `social/posts` (+ `[id]`), `social/series` (+ `[id]`), `social/signatures` (+ `[id]`), `social/oauth/start`, `social/oauth/callback` | Sessão ou chave, filtro por `userId`; o callback ainda confere o `state` assinado do usuário |

Rotas sem autenticação própria: as 4 de `auth/*` (intencional), `public-media` (token), `docs` (acidental, baixa gravidade). Webhooks e integração estão protegidos por assinatura. Fora das rotas HTTP, o Socket.IO em `/api/socket/io` está sem autenticação alguma (item 2) e é a exposição mais séria.

## Prioridade sugerida

1. Item 2 (Socket.IO): fechar primeiro; permite ver QR e mensagens de qualquer sessão.
2. Item 1 (redirect OAuth) e `BASE_URL` obrigatório: correção pequena.
3. Itens 4, 5 e 6 (resultado desconhecido, claim antes do envio, reserva do aviso-worker).
4. Item 7 antes de entrar a segunda loja na Cloud API.
5. Itens 8 e 9 quando a agência for ligada ao CRM.
