# Diagnóstico: respostas automáticas "não saem" com o painel aberto

Relato: as respostas automáticas do WhatsApp (`src/modules/whatsapp/store/autoreply.ts`) parecem não ser enviadas enquanto o painel do CRM está aberto. Este documento separa o que foi **verificado lendo o código** do que **ainda precisa de teste no staging**. Nenhum comportamento de envio foi alterado; a única mudança de código foi exportar `canAutoReply` para permitir o teste `autoreply-permissao.test.ts`.

## 1. Caminho no código (verificado)

| # | Passo | Local | Observação |
|---|-------|-------|------------|
| 1 | Conexão abre, `bindAutoReply` é ligado ao socket | `src/modules/whatsapp/instance.ts:263-292` | Roda a cada `connection === "open"`. Antes dele há dois `await`: `backfillContactNames` (:281) e `syncGroups` (:287), ambos em `try/catch`, mas sem limite de tempo. |
| 2 | Cada reconexão cria um socket novo | `instance.ts:238-240` (`init()`), `:75` (`makeWASocket`) | `bindAutoReply` usa um `WeakSet` por socket (`autoreply.ts:57,61-62`): o mesmo socket nunca ganha dois ouvintes; um socket novo ganha um. |
| 3 | O `sendMessage` do socket é embrulhado | `instance.ts:89-99` | Todo envio passa por `antispam.enqueue` (:93), depois `marcarEnviadaPeloCrm(messageId)` (:96, definida em `src/modules/agente-salao/enviados.ts:10`) e `registrarOrigem` (:97, só 1:1), e só então o `sendMessage` original (:98). |
| 4 | Evento `messages.upsert` | `autoreply.ts:63` | Ignora tudo que não for `type === 'notify'` (:64). É um ouvinte próprio, independente do ouvinte do store (`store/index.ts:32`). |
| 5 | Carrega sessão e `botConfig` | `autoreply.ts:67-86` | Se não houver config, cria uma padrão `enabled: true`, `autoReplyMode: 'ALL'` (:76-86). `enabled=false` encerra em :90. |
| 6 | Define remetente | `autoreply.ts:93-105` | `fromMe` vem de `msg.key.fromMe`; em 1:1 usa `remoteJidAlt` quando existir (:101). |
| 7 | Permissão | `autoreply.ts:108` -> `canAutoReply` (:10-55) | Modo `ALL` + `fromMe=true` retorna `false` (:28). Modo `OWNER` só responde `fromMe=true` (:27, :34). Coberto por `autoreply-permissao.test.ts`. |
| 8 | Extrai texto | `autoreply.ts:110-113` | Mensagem sem `conversation`/`extendedTextMessage.text` (imagem, áudio, legenda) é ignorada, sem log. |
| 9 | Busca regras e casa | `autoreply.ts:117-126` (`casaRegra`) | Filtra por `triggerType` GROUP/PRIVATE (:131-132). |
| 10 | Log de acerto | `autoreply.ts:134` | `logger.info("AutoReply", "Match: <keyword> -> <jid>")`. Sai em qualquer ambiente. |
| 11 | Envio | `autoreply.ts:153` (mídia), `:157` (fallback texto), `:161` (texto) | Chama o `sock.sendMessage` já embrulhado do passo 3. |
| 12 | Fila anti-spam | `antispam.ts:44-80` (`enqueue`), `:82-156` (`processQueue`) | Desligado (`antiSpamEnabled=false`) ou sem config: retorna na hora (:47-49). Ligado: enfileira por sessão; se `recentMessages >= spamLimit` na janela de `spamInterval` s, dorme um atraso aleatório entre `spamDelayMin` e `spamDelayMax` ms (:105-118). Defaults: 5 msgs/10 s, atraso 1000-3000 ms (:231-235). Config em cache por 10 s (:204). |

### Dependência de navegador conectado

Procurado em `instance.ts`, `store/index.ts`, `autoreply.ts`, `antispam.ts`, `manager.ts` e nas rotas de chat:

- Nada no caminho 4 a 12 lê estado de navegador ou de Socket.IO. O `io` só é usado para **emitir** (`store/index.ts:41,88`; `instance.ts:229,247,271`) com `io?.to(sessionId).emit(...)`, que não bloqueia nem falha sem ouvintes. `src/server/socket.ts:13-15` só coloca o socket na sala (`join-session`).
- `store/index.ts:62` chama `sock.readMessages` com `await` quando `autoRead` está ligado, mas isso roda no ouvinte do store, separado do ouvinte do auto-reply; não atrasa nem bloqueia `autoreply.ts`.
- `presence/route.ts:41` (`sendPresenceUpdate`) e `read/route.ts:43,52` (`readMessages`/`chatModify`) existem como rotas de API. Busquei chamadas a elas em `src/app/dashboard`, `src/components`, `src/hooks` e `src/lib` e **não achei nenhuma** no front. Portanto o painel aberto não dispara presença nem leitura por esse caminho.
- Única relação com "painel aberto" encontrada: o painel escolhe a sessão por `useSession()` / `join-session` (`src/components/chat/socket-context.tsx:52`, `src/app/dashboard/sessions/[sessionId]/page.tsx:104`). Se a sessão selecionada não for a do número testado, parece que "a resposta não saiu", mas é outra sessão. Isso é questão de uso, não de código; não foi verificado em tela.

Conclusão da leitura: **não há, no código lido, nenhum ponto em que a resposta automática dependa de um navegador conectado.** O sintoma, se real, tem de vir de outro lugar (tabela da seção 2).

### Ressalvas encontradas na leitura (não corrigidas, fora do escopo)

1. `logger.debug` é silenciado quando `NODE_ENV=production` (`src/lib/logger.ts:84-86`). Por isso a linha `QUEUED` do anti-spam (`antispam.ts:73`, debug) e `Processing for` do auto-reply (`autoreply.ts:88`, debug) **não aparecem** com `NODE_ENV=production`. As linhas `INSTANT`/`SENDING` (success), `DELAY` (warn) e `Match` (info) aparecem sempre.
2. `BAILEYS_LOG_LEVEL` (`instance.ts:73`) só controla o log do Baileys (pino). Não altera o `logger` do CRM. Serve para ver `messages.upsert` chegando, não as linhas do CRM.
3. `bindAutoReply` só é ligado depois de `backfillContactNames` e `syncGroups` (`instance.ts:281-292`). Mensagens recebidas nesse intervalo não passam pelo auto-reply, e se `syncGroups` travar sem lançar erro, o auto-reply nunca é ligado naquela conexão. Não reproduzido; é hipótese de leitura.
4. `antispam.ts:86-90`: se `getAntiSpamConfig` retornar `null` dentro de `processQueue` (cache expirou e a consulta falhou, :240-243) enquanto há itens na fila, `processing` volta a `false` e os itens ficam sem `resolve()`; enquanto o `null` ficar em cache (10 s, `:204`) o `enqueue` retorna cedo (:47-49) e não reinicia o processamento, então os `sendMessage` pendentes só andam depois que o cache expirar e um `enqueue` posterior obtiver a config. Exige falha de banco no instante exato; baixa probabilidade.
5. `canAutoReply` compara `senderJid.includes(jid)` (`autoreply.ts:40,47`): casamento por trecho, não por igualdade. Pode casar números parecidos nas listas SPECIFIC/BLACKLIST. Não relacionado ao relato.

## 2. Causas candidatas e como confirmar ou descartar

| Causa | Evidência no código | Como confirmar | Como descartar |
|-------|---------------------|----------------|----------------|
| A. Teste feito pelo próprio número da sessão | `canAutoReply`: `ALL` + `fromMe` retorna `false` (`autoreply.ts:28`); teste `autoreply-permissao.test.ts` | Enviar a mensagem-gatilho do mesmo celular que está conectado como sessão e ver que não há `Match` no log | Enviar de **outro** número. Se `Match` aparece e a resposta sai, a causa era essa |
| B. Atraso do anti-spam | `antispam.ts:105-118`: atraso de 1-3 s (default) quando o limite é atingido | Com anti-spam ligado, ver `DELAY` com `Waiting:` alto (`antispam.ts:114`) ou `SENDING` com `Waited:` alto (:144), ou resposta que chega segundos depois | Desligar `antiSpamEnabled` no `botConfig`; resposta imediata sem linha de anti-spam descarta |
| C. Duas instâncias do CRM (staging e produção) na mesma sessão | Cada instância abre seu próprio socket (`instance.ts:75`); hipótese, não demonstrada pelo código: o WhatsApp derrubaria uma das conexões simultâneas da mesma sessão, o que apareceria como reconexão em `instance.ts:238-240` | Nos logs das duas: `Session ... disconnected. Reconnecting` em ciclo, ou `messages.upsert` chegando só de um lado. Comparar `sessionId` e número conectado em cada ambiente no Railway | Parar um dos ambientes e repetir o teste; ou confirmar que cada ambiente usa número/sessão diferente |
| D. Seletor do painel apontando outra sessão | O painel usa `useSession()`/`join-session`; o auto-reply roda pelo `sessionId` do socket (`autoreply.ts:59`), não pelo do painel | Conferir no painel qual sessão está selecionada e se é a do número testado; ver o `sessionId` nas linhas de log | Testar com a sessão do número testado selecionada (ou com uma única sessão existente) |

## 3. Roteiro de reprodução no staging (para o João)

Pré-requisitos: acesso aos logs do Railway do staging; dois números (o da sessão e um **outro** para mandar mensagem); uma regra de auto-reply simples, por exemplo palavra `teste` / tipo `EXACT` / resposta `ok`.

1. No Railway (staging), definir `BAILEYS_LOG_LEVEL=debug` e reiniciar. Anotar o valor de `NODE_ENV`: com `production`, as linhas `QUEUED` e `Processing for` não aparecem (ressalva 1). Para vê-las, usar temporariamente outro valor de `NODE_ENV`.
2. Conferir produção x staging: abrir as variáveis dos dois ambientes no Railway e confirmar que **não** conectam à mesma sessão/número (comparar `sessionId` e número em Sessões). Se forem a mesma, parar um dos dois antes de seguir.
3. Caso (a), **painel fechado**: fechar todas as abas do CRM. Do **outro** número, enviar `teste` para o número da sessão. Anotar: chegou `messages.upsert` nos logs do Baileys? Apareceu `[AutoReply] Match: teste -> <jid>`? A resposta chegou?
4. Caso (b), **painel aberto**: abrir o painel na página de chat, com a sessão do número testado selecionada. Repetir o envio do outro número e anotar os mesmos três pontos.
5. Caso (c), **anti-spam ligado e desligado**: repetir (a) e (b) com o anti-spam ligado e depois desligado. Procurar `✅ INSTANT` (envio imediato), `⏳ DELAY` e `✅ SENDING` (houve espera). Com o anti-spam desligado não aparece linha do anti-spam.
6. Caso (d), **mensagem do próprio número**: do celular da sessão, enviar `teste` para outro contato. Esperado pelo código: nenhum `Match`, por causa de `canAutoReply` no modo `ALL`.
7. Preencher a tabela:

| Caso | `messages.upsert` chegou | `AutoReply Match` | Anti-spam (`INSTANT`/`DELAY`/`SENDING`) | Resposta recebida |
|------|--------------------------|-------------------|------------------------------------------|-------------------|
| (a) painel fechado, outro número | | | | |
| (b) painel aberto, outro número | | | | |
| (c) anti-spam ligado / desligado | | | | |
| (d) próprio número | | | | |

Linhas a procurar nos logs:

- `[AutoReply] Match: <palavra> -> <jid>` (sempre visível).
- Anti-spam: `✅ INSTANT` ou `✅ SENDING` (visíveis), `⏳ DELAY` (aviso), `📥 QUEUED` (só com `NODE_ENV` diferente de `production`).
- Falha no envio: `Failed to send media auto-reply` ou `Error executing auto-reply` (nível erro).

Interpretação:

- `messages.upsert` chega e há `Match`, mas a resposta não chega: problema no envio, no anti-spam ou no WhatsApp.
- `messages.upsert` não chega só com o painel aberto: suspeitar de C (outra instância na mesma sessão).
- `messages.upsert` chega e não há `Match`: A (próprio número), regra que não casa, ou `enabled=false`.

Resultado: não reproduzido (pendente de teste no staging)
