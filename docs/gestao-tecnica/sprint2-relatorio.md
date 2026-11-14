# Sprint 2: confiabilidade de mensagens (relatório)

Branch `fix/sprint2-confiabilidade-mensagens`, base `origin/main` = `48cb963`. Nada foi enviado, publicado, implantado nem aplicado em banco real. Todos os testes usam mocks do provedor e banco em memória.

## Resultado por item

| # | Item | Estado |
|---|------|--------|
| 1 | `cron.ts`: claim atômico, atraso, falha registrada, série sem conta | OK nos testes (precisa teste em staging) |
| 2 | Classificação de falhas (transitória, definitiva, política, desconhecido) | OK nos testes |
| 3 | Registro durável de tentativas | OK: tabela nova aditiva, **precisa revisão do João antes do merge** |
| 4 | Broadcast manual e `aviso-worker` | OK nos testes (precisa teste em staging) |
| 5 | Cloud API/templates | Nenhuma lacuna pequena e comprovada; ver backlog |

## Causas comprovadas e correções

### 1. `src/lib/cron.ts` (mensagens agendadas e recorrentes)
Causa (achados 4 e 5, revalidados no código): enviava e só depois atualizava o status, sem reserva. Reinício ou segunda instância entre os dois passos repetia o envio. A próxima data de recorrente era calculada a partir de "agora", então ocorrências atrasadas sumiam em silêncio. Erro de envio e bloqueio de plano em recorrente avançavam sem gravar nada. Mensagem única falhava na primeira falha, sem motivo gravado.

Correção:
- Claim atômico: `ScheduledMessageAttempt` tem `@@unique([scheduledMessageId, occurrenceAt])`. Quem cria a linha é o único que envia aquela ocorrência. Em recorrente, a série é avançada por `updateMany` condicional em `sendAt` logo após o claim.
- Reserva sem desfecho: linha `claimed` há mais de 10 min (processo morreu) vira `unknown` e **nunca é reenviada**. Mensagem única vira `FAILED`; recorrente já avançou (ou avança no ciclo seguinte).
- Ocorrências atrasadas, política decidida (a mais segura): envia no máximo UMA, a mais recente, e só se tiver até 6 h de atraso (`MAX_ATRASO_MS`). As anteriores ficam gravadas como `missed` com motivo ("substituída pela mais recente" ou "fora do prazo"). Se até a mais recente passou de 6 h, nada é enviado, tudo fica registrado como `missed` e a série segue. Mensagem única vencida há mais de 6 h (ex.: sessão ficou desconectada dias) vira `FAILED` com registro `missed`. Antes saía texto velho ao reconectar.
- Falha de recorrente e bloqueio de plano ficam gravados (`failed`, com classe e motivo). Expressão cron inválida vira `FAILED` visível, em vez de repetir erro todo minuto.
- Consumo (`recordMessages`) que falha depois do envio não vira falha nem reenvio.
- Séries sociais (`series.ts`): sem conta viva a série passa a `PAUSED` (antes `ENDED` em silêncio) e cria `Notification` de aviso para o dono. Reconectar a conta e reativar retoma.

### 2. Classificação de falhas (`src/lib/send-failure.ts`)
- `transient`: retentar com espera crescente (30 s, 2 min, 10 min; no máximo 4 tentativas). Inclui limite de taxa da Cloud e, por padrão, erros comuns sem sinal de que a mensagem saiu (mantém o comportamento anterior de retentar).
- `permanent`: número sem WhatsApp, token inválido, número não entregável, pedido inválido.
- `policy`: descadastro, "só quem já interagiu", janela de 24 h fechada, template exigido.
- `unknown`: tempo esgotado, conexão caiu, `CloudApiError` `network`/`server`/`unexpected_response`. **Nunca reenviado.** Cloud API: sem o id da mensagem não há como consultar status; Baileys não tem confirmação posterior. Reconciliação automática por id/status da Cloud NÃO foi implementada (ver backlog). O registro fica visível.
- Aplicado em: `cron.ts`, `aviso-worker.ts` e disparo manual (marca o destinatário com "Resultado desconhecido (pode ter sido enviado, não reenviar sem conferir)").

### 3. Registro durável
Tabela nova `ScheduledMessageAttempt` (commit `db:` separado, só model novo, sem relação com tabela existente, sem alterar colunas). Campos: `scheduledMessageId`, `occurrenceAt`, `status` (`claimed|sent|failed|unknown|missed`), `failureClass`, `error` (máx. 500 caracteres da mensagem de erro; pode conter número de telefone, ver riscos), `claimedAt`, `finishedAt`. Para o aviso-worker não foi preciso tabela: usou campos existentes (`estado` ganha o valor `enviando`; `motivo` ganha códigos fixos).

### 4. Broadcast manual e `aviso-worker`
- Broadcast manual (`broadcast/route.ts`): a trava em memória era setada depois de vários `await`. Troquei por trava no banco (`JobLock`, nova função `startJobLock` em `job-lock.ts`, `broadcast:<sessionId>`, renovada enquanto roda, TTL 2 min se o processo morrer). A trava é pega antes de qualquer trabalho (plano, criação do log) e liberada em qualquer erro antes de iniciar e ao fim do disparo. Vale entre instâncias. Efeito colateral: após queda do processo, um novo disparo no mesmo número pode levar até 2 min para ser aceito (409 `BROADCAST_RUNNING`).
- `aviso-worker.ts`: a reserva usava `agora` fixo do início do lote com `RESERVA_MS` de 60 s, então itens do fim do lote podiam ter a reserva vencida e ser pegos por outra instância. Agora a reserva usa o relógio na hora de cada item, `RESERVA_MS` = 120 s, e `finalizar`/`adiar` viraram `updateMany` condicional pela reserva do próprio worker (perdeu a posse, não grava). Antes de chamar o provedor o aviso vira `enviando`; se o processo morrer ali, após 5 min vira `falhou/resultado_desconhecido` em vez de ser reenviado. Falha desconhecida não retenta. Tempo esgotado ANTES de marcar `enviando` (ex.: resolver número) continua sendo retentado.

## Arquivos
- Novo: `src/lib/send-failure.ts`, `src/lib/send-failure.test.ts`
- Alterados: `prisma/schema.prisma` (só model novo), `src/lib/cron.ts`, `src/lib/cron.test.ts` (reescrito, banco em memória), `src/lib/job-lock.ts` (+`startJobLock`, `withJobLock` o usa), `src/lib/job-lock.test.ts`, `src/modules/integracao/comanda/aviso-worker.ts` e `.test.ts`, `src/app/api/messages/[sessionId]/broadcast/route.ts` e `route.test.ts`, `src/modules/social/series.ts` e `.test.ts`

## Testes e resultados reais
- `npm run typecheck`: sem erros.
- `npm test`: 129 arquivos, 2204 testes, todos passaram (inclusive `capability-routes.test.ts`, que nesta execução NÃO deu timeout do sharp).
- `npm run lint`: 173 erros, 158 avisos no repositório inteiro (baseline informada: 174 erros). Os arquivos que criei estão limpos; os erros que restam nos arquivos que editei (`any` em `broadcast/route.ts`, `_args` em `series.test.ts`) já existiam.
- `npm run build` com env fictício (`DATABASE_URL`, `AUTH_SECRET`): concluiu.
- Cobertura nova: concorrência (duas instâncias, um envio, mensagem única e recorrente), queda e recuperação (reserva órfã recente/vencida, única e recorrente, próxima ocorrência sai sem duplicar nem perder), retry com backoff sem duplicação e limite de tentativas, resultado desconhecido não reenvia (Baileys e Cloud), recorrente atrasada (dentro e fora do prazo), recorrente com falha registrada, cron inválida, série sem conta (pausa e aviso, sem aviso duplicado), broadcast com chamadas simultâneas (um 200 e um 409) e trava liberada em erro, aviso-worker com dois workers, posse perdida, lote longo, `enviando` órfão.

## O que NÃO foi verificado
- Nenhum teste contra MySQL real: a unicidade e o `updateMany` condicional foram emulados em memória. O comportamento de `createMany({ skipDuplicates })` e do código `P2002` no MySQL real não foi exercitado.
- Nenhum envio real (Baileys ou Cloud). Padrões de erro de tempo esgotado do Baileys (`Timed Out`, `Connection Closed`) vêm do conhecimento das mensagens da biblioteca, não de captura real.
- `scheduler.ts` social: o critério de 15 min de `PUBLISHING` (usa `publishAt`, não o horário do claim) não foi alterado.
- `disparos/worker.ts` (campanhas) e `order-notifier.ts` não foram alterados.
- Códigos de erro da Meta já eram marcados como "não verificados" em `cloud/errors.ts`; a classificação herda essa incerteza.

## Riscos
1. **Schema**: o `Dockerfile` roda `prisma db push` em todo start. O model novo é aditivo (cria tabela), então o `db push` não perde dados, mas **o João precisa revisar antes do merge** (regra do `plano-migracao-rollback.md`). Fazer backup antes do merge e testar primeiro no staging.
2. At-most-once: se o processo morrer entre a reserva e o envio, a ocorrência fica `unknown` e NÃO é enviada (pode nunca ter saído). É a troca deliberada por não duplicar mensagem; fica visível na tabela, mas hoje não há tela nem notificação para isso.
3. Retentativa só existe para mensagem única. Recorrente com falha transitória registra a falha e espera a próxima ocorrência.
4. Mensagem única que falha por erro comum agora é retentada (até 4 tentativas, 30 s a 10 min), antes ficava `FAILED` na hora. É mudança de comportamento pedida, mas visível.
5. `error` em `ScheduledMessageAttempt` guarda até 500 caracteres da mensagem de erro, que pode incluir número de telefone. Os códigos fixos do aviso-worker (que evitam dado pessoal) foram mantidos.
6. Linhas de `ScheduledMessageAttempt` não são apagadas junto com a mensagem (sem relação Prisma) nem têm retenção. Crescimento é pequeno, mas precisa de limpeza no `retention.ts`.
7. Trava do broadcast: 409 por até 2 min depois de queda do processo.

## Roteiro de teste em staging
1. Aplicar o schema em staging (db push do deploy) e conferir que existe a tabela `ScheduledMessageAttempt` e que nada mais mudou.
2. Agendar uma mensagem única para 2 min à frente numa sessão de teste; conferir uma linha `sent` e `status=SENT`.
3. Agendar recorrente diária; conferir `sendAt` avançando e linha `sent`.
4. Subir duas instâncias (ou duas réplicas) com uma mensagem vencendo; conferir um único recebimento e uma única linha.
5. Parar o processo logo após o claim (kill durante o `sleep`) e reiniciar: depois de 10 min a linha deve virar `unknown` e a mensagem não ser reenviada.
6. Desconectar a sessão por mais de 6 h, reconectar: ocorrência vencida deve virar `missed` (sem envio).
7. Disparo manual: duas chamadas simultâneas ao mesmo número devem dar uma 200 e uma 409; ao terminar, um novo disparo deve ser aceito.
8. Aviso de pedido: derrubar o processo durante o envio; conferir `falhou/resultado_desconhecido` e nenhum duplicado.
9. Série social sem conta (desconectar a conta): deve ficar `PAUSED` e a notificação aparecer.

## Rollback
- Código: reverter os commits da branch; o worker volta ao comportamento anterior. A tabela nova pode ficar no banco sem uso (aditiva). Remover manualmente só se quiser, com backup.
- Linhas `enviando` do aviso-worker: se revertido com linhas nesse estado, nada as reprocessa; ajustar manualmente para `falhou` ou `pendente` conforme o caso.
- Mensagens agendadas ficam como estavam (`status` continua `PENDING|SENT|FAILED`); nenhum novo valor foi criado em `ScheduledMessage`.

## Pendências e backlog
- Schema: revisão do João do model `ScheduledMessageAttempt` antes do merge; retenção das linhas.
- Reconciliar "resultado desconhecido" da Cloud API: exige guardar o id da mensagem (wamid) por tentativa e usar o status do webhook; hoje o webhook só gera log.
- Mostrar `unknown`/`missed` na tela de mensagens agendadas e notificar o dono.
- Mesmo padrão `enviando` em `disparos/worker.ts` (campanhas) e idempotência/relato em `order-notifier.ts` (dedupe em memória).
- Retentativa de recorrente dentro da própria ocorrência.
- Critério dos 15 min do `scheduler.ts` social com o horário do claim; validade máxima de post vencido.
- Tetos por número ainda são contados antes do envio, sem trava (efeito pequeno).
- Cloud API/templates: sem lacuna pequena comprovada; a seleção da primeira sessão Cloud (achado 7) e roteamento por `phoneNumberId` ficam para outra sprint.
