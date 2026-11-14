# Sprint 1 - Segurança (Socket.IO e OAuth Meta)

Branch `fix/sprint1-socket-oauth`, criada de `origin/main` (48cb963). Sem push, sem deploy, sem Meta real, sem banco real.

## A) Socket.IO (crítico) - causa comprovada e correção

Causa (lida no código): `src/server/index.ts` usava `cors.origin: "*"` e nenhum `io.use`; `src/server/socket.ts` fazia `socket.join(sessionId)` e `socket.join("user:"+id)` com o texto enviado pelo cliente. O Socket.IO atende `/api/socket/io` direto no servidor HTTP, então `src/proxy.ts` não protege o socket. Quem conhecesse (ou adivinhasse) um `sessionId` recebia QR de pareamento, mensagens e progresso de disparos.

Correção:
- Handshake (`io.use`): decodifica o cookie de sessão do Auth.js com `getToken` (`next-auth/jwt`, `AUTH_SECRET`; tenta `__Secure-authjs.session-token` e `authjs.session-token`, o nome do cookie é o salt do JWT). Sem cookie válido, token vencido ou usuário inexistente no banco: `unauthorized`. API key não é aceita porque nenhum cliente do socket a usa (os 3 clientes são do painel, mesma origem, `io({path})`, o cookie vai sozinho: nenhuma mudança no front).
- `join-session`: relê o papel do usuário no banco e exige `canAccessSession` (mesma regra das rotas HTTP). Recusa também ids que começam com `user:` (impede que uma sessão chamada `user:<id-da-vítima>` entre na sala de notificações alheia).
- `join-user-room`: o argumento do cliente é ignorado; entra só em `user:<id autenticado>`.
- Origem: `index.ts` troca `*` por `allowedOrigins()` (BASE_URL, NEXTAUTH_URL e lista opcional `SOCKET_ALLOWED_ORIGINS`, separada por vírgula) e `allowRequest` recusa requisição com `Origin` fora da lista; sem lista configurada só aceita Origin do mesmo host. Requisição sem `Origin` (não navegador) passa, mas ainda precisa do cookie.
- Revogação: a cada 60 s (`REVALIDATE_MS`) o servidor confere cada socket: token vencido ou usuário apagado desconecta; perda de acesso a uma sessão tira o socket da sala. Atraso máximo 60 s; todo `join-session` novo é conferido na hora. Escolhi intervalo (e não checagem a cada emissão) por ser a mudança mínima, sem tocar nos ~15 pontos que emitem eventos.

Arquivos: `src/server/socket.ts`, `src/server/index.ts`.

## B) OAuth Meta (parcial) - causa e correção

Causa: `callback/route.ts` e `start/route.ts` montavam os redirects finais com `request.nextUrl.origin`, que atrás do proxy (servidor com `HOSTNAME=0.0.0.0`) pode ser `localhost`/`0.0.0.0`. O `state` já existe (HMAC com usuário e validade de 10 min) e foi mantido sem alteração.

Correção: nova `baseUrl(origin, headers)` em `src/modules/social/oauth.ts`: `BASE_URL`, depois `NEXTAUTH_URL`; sem nenhuma, usa `x-forwarded-host/proto` se o origin for loopback; em `NODE_ENV=production`, se ainda for localhost/0.0.0.0/127.x, lança erro claro em vez de redirecionar. `urlDeRetorno` usa a mesma função. Com BASE_URL definida o `redirect_uri` enviado à Meta é idêntico ao anterior (há teste). Arquivos: `oauth.ts`, `callback/route.ts`, `start/route.ts`.

Não alterado (fora do pedido): `scheduler.ts publicMediaUrl` (só BASE_URL) e fallback `localhost:3000` em `stripe-billing.ts`, citados na revalidação.

## C) Mídia (achado 3)

Reconferido o fechamento em `api/media/[filename]/route.ts` (auth, `canAccessSession`, anti traversal). Sem alteração. Resíduos baixos da revalidação (prefixo do nome de arquivo, `message.findMany` sem filtro de sessão em `GET /api/media`) permanecem, sem vazamento.

## D) `proxy.ts` / `docs`

`x-api-key` com qualquer valor passa pelo proxy e `GET /api/docs` não valida a chave, então a especificação OpenAPI é legível com `x-api-key: x`. Risco baixo (documentação). Não corrigido: não é uma linha segura (exigiria validar a chave na rota ou mudar o proxy para todas as rotas). Fica para item próprio.

## Testes e resultados reais

Novos: `src/server/socket.test.ts` (15 testes, servidor Socket.IO real + clientes reais: sem credencial, cookie inválido, token vencido, usuário apagado, origem proibida e permitida, isolamento de dois usuários, `join-user-room` forjado, colisão `user:`, revogação por sala, por usuário apagado e por token vencido), `src/server/socket-identify.test.ts` (3, JWT real do Auth.js nos dois nomes de cookie, segredo errado, salt errado), `src/app/api/social/oauth/oauth-routes.test.ts` (4: start, start não configurado, callback negado/state inválido/state de outro usuário, callback feliz com o mesmo redirect_uri) e 5 casos de `baseUrl` em `oauth.test.ts`.

- `npm test`: 131 arquivos, 2183 testes, todos passam.
- `npm run typecheck`: sem erros (após `npx prisma generate`, que só gera o client local, sem banco).
- `npm run lint`: 332 problemas (174 erros, 158 avisos), idênticos ao baseline de `origin/main` (conferido com `git stash`); os arquivos alterados e novos não têm nenhum.
- `npm run build` com `AUTH_SECRET`, `BASE_URL`, `DATABASE_URL` fictícios só no processo: compilou.

## Não verificado

- Navegador real em staging: cookie `__Secure-` atrás do proxy do Railway (o decodificador foi testado com JWT real, não o caminho HTTP completo do Next).
- Que o proxy encaminha o header `Cookie` no upgrade de WebSocket.
- Fluxo real com a Meta (proibido).
- Valores de BASE_URL/NEXTAUTH_URL de produção (não li variáveis).

## Riscos

- Se BASE_URL/NEXTAUTH_URL tem host diferente do que o usuário acessa (domínio alternativo), o `allowRequest` bloqueia o socket desse domínio. Remédio: incluir o domínio em `SOCKET_ALLOWED_ORIGINS`.
- Em produção sem BASE_URL/NEXTAUTH_URL e sem `x-forwarded-host`, as rotas OAuth dão erro 500 (de propósito) em vez de redirecionar para localhost.
- Uma consulta ao banco (papel do usuário) por join e por revalidação, por socket, a cada 60 s.
- Revogação em até 60 s, não instantânea.
- Sessão do navegador expirada com a aba aberta: o socket cai na revalidação e só volta ao recarregar a página.

## Teste manual em staging

1. Logado, abrir uma sessão no painel: QR/status chegam; notificações do sino chegam.
2. Sem login (aba anônima), abrir `wss://<staging>/api/socket/io/?EIO=4&transport=websocket`: recusado.
3. `curl -H "Origin: https://evil.example" "<staging>/api/socket/io/?EIO=4&transport=polling"`: 403.
4. Logado como usuário B, emitir `join-session` com a sessão do usuário A no console: nenhum evento de A chega.
5. Remover o acesso compartilhado de um usuário com a aba aberta: em até 60 s para de receber.
6. Conectar conta em Redes sociais > Contas: o retorno cai na URL pública, nunca em localhost.

## Rollback

`git revert` dos commits da branch (mudanças só em `src/server`, `oauth.ts` e as duas rotas OAuth); sem migração; nenhuma variável nova obrigatória (`SOCKET_ALLOWED_ORIGINS` é opcional).

## Ajustes pós-revisão

Revisão independente aprovou com ajustes. Mudanças (cada uma com teste vitest):

1. **Revalidação sem reentrância** (`socket.ts`): flag `rodando` pula a rodada se a anterior não terminou; dentro da rodada o papel é consultado uma vez por usuário (cache em Map).
2. **Limites de join-session**: máximo de `MAX_SALAS` = 20 salas por socket e intervalo mínimo de `JOIN_MIN_MS` = 150 ms entre joins; excedeu, o servidor emite `join-session:erro` (`limite-de-salas` ou `muitas-requisicoes`) e mantém o socket conectado.
3. **Item 3 (origem bloqueada se BASE_URL difere do domínio de acesso)**: sem mudança de código, só documentação: `SOCKET_ALLOWED_ORIGINS` acrescentada em `docs/ENVIRONMENT_VARIABLES.md`. Já descrita em "Riscos".
4. **x-forwarded-host validado** (`oauth.ts`) com `^[a-z0-9.-]+(:d+)?$`; fora do padrão (barra, espaço, `@`, esquema) lança erro. Em produção, sem BASE_URL/NEXTAUTH_URL, o host do proxy não é mais aceito (lança): **mudança de comportamento**, o fallback antigo por proxy só vale fora de produção.
5. **Rotas OAuth** (`start` e `callback`): `baseUrl()` agora dentro de try/catch; em falha respondem 302 com `Location` relativo `/dashboard/redes-sociais/contas?oauth=nao-configurado` (mesmo parâmetro já usado nas rotas) e registram aviso no log.
6. **Guarda de loopback** também para BASE_URL/NEXTAUTH_URL configurados: em produção, localhost/127.x/0.0.0.0/[::1] lança erro.
7. **Reconexão no front**: `src/lib/socket-reconectar.ts` (espera de 5 s dobrando até 60 s, zera ao conectar, cancela em disconnect manual) ligada nos 4 pontos que abrem socket (página da sessão, session-manager, navbar, socket-context); cobre `io server disconnect` e `connect_error`. O cliente já reconectava nos demais casos.
8. **Campo de bloqueio no User**: não existe (só `planStatus` = ACTIVE|SUSPENDED, que é cobrança). `loadRole` não foi alterado. Usuário bloqueado hoje = usuário apagado.

### Resultados reais
- `npm run typecheck`: sem erros.
- `npm test` (suíte completa): 132 arquivos, 2194 testes, todos passaram (inclusive capability-routes nesta execução).
- ESLint nos arquivos alterados: 1 erro (`react-hooks/set-state-in-effect` em navbar.tsx) e 22 avisos, todos de código anterior a este ajuste (não verificado por `git stash`; as linhas apontadas não são as alteradas).

### Não verificado
- Reconexão do front em navegador real (testada só com socket simulado) e sob proxy de produção.
- Comportamento em produção sem BASE_URL: depende de a variável estar definida no Railway (não consultado); sem ela o login social passa a redirecionar para `nao-configurado`.
- Teste de carga das salas/revalidação.

