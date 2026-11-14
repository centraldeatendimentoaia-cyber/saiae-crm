# Sprint 5 (Motor de automações): relatório

Branch `feat/sprint5-motor-automacoes` (já contém Sprints 2 e 3). Desenho em `sprint5-desenho.md`. Nada foi enviado, implantado, aplicado em banco real nem testado contra Meta/WhatsApp real. Nenhum envio real: provedor e relógio são simulados nos testes.

## Decisões

- Executor puro sobre duas interfaces injetáveis (`Store`, `Deps`): a lógica é testada sem banco; `store-prisma.ts` é a implementação real (claim e gravação são `UPDATE` condicionais).
- Fluxos em JSON versionado (`schemaVersion: 1`); rascunho no fluxo, versão publicada imutável.
- Condição como objeto com operadores fixos (não há linguagem de texto, então nada a executar nem escapar).
- Envio: reserva `claimed` gravada antes de chamar o provedor. Sobra sem desfecho = `unknown`, execução falha, nunca reenvia (política do Sprint 2).
- Cancelamento automático por consulta ao retomar e antes de cada envio (`quemPodeEnviar` e `isOptedOut`), mais `cancelarRunsDoContato` para ganchos externos.
- Worker desligado por padrão (`AUTOMACOES_ATIVAS=true` liga). Sem gatilho real; só `POST /api/automacoes/[id]/iniciar`.
- Sem FK para `User`/`Session` (nenhum modelo existente foi tocado).

## Arquivos

Schema (commit `db:` separado, a5389bf): `prisma/schema.prisma` (+4 modelos, só aditivo).

Código (commit e4ed795):
- `src/modules/automacoes/`: `tipos.ts`, `expressao.ts`, `validador.ts`, `executor.ts`, `store-prisma.ts`, `servico.ts`, `worker.ts`, `testes-util.ts`.
- `src/app/api/automacoes/`: `route.ts`, `[id]/publicar`, `[id]/iniciar`, `runs/[runId]`, `runs/[runId]/cancelar`.
- `src/lib/cron.ts`: 2 linhas (import e `startAutomacoes()`).
- Docs: `sprint5-desenho.md`, este relatório.

## Testes (vitest, 50 novos)

`expressao.test.ts` (condição segura com tentativas de injeção, interpolação, validador de grafo), `executor.test.ts` (28: transições, espera e retomada com contexto, dois executores, queda no meio do envio e depois dele, resultado desconhecido, transitória com backoff e esgotamento, política Cloud, humano e opt-out, cancelamento manual e externo, loop e timeout), `servico.test.ts` (deduplicação, limite simultâneo, escopo por usuário, publicação com validador, claim/salvar condicionais no Prisma simulado).

## Resultados reais

| Item | Resultado |
|---|---|
| `npx prisma generate` | OK (após `npm ci` no worktree; ele não tinha `node_modules`) |
| `npm run typecheck` | OK, sem erros |
| `npm test` (suíte completa) | 137 arquivos, 2311 testes, todos passando |
| lint (`eslint` em `src/modules/automacoes`, `src/app/api/automacoes`, `src/lib/cron.ts`) | sem problemas |
| `npm run build` (env fictício só no processo) | OK; rotas `/api/automacoes/*` geradas |

## Não verificado

- Nada contra MySQL real: o claim concorrente foi provado só com banco em memória (semântica equivalente) e conferindo o `WHERE` e `count === 1` no Prisma simulado. Falta rodar duas instâncias contra o banco do staging.
- Envio real (Baileys/Cloud), janela de 24 h com dados reais, etiqueta e transferência humana contra tabelas reais.
- A migração SQL do schema (não gerada; ver pendências).
- `Label.sessionId` foi gravado com `Session.sessionId` (nome); o código existente mistura nome e id conforme o chamador. Confirmar no staging que a etiqueta aparece no painel.

## Riscos

- Limite de execuções simultâneas é "contar e depois gravar": duas partidas simultâneas com `dedupeKey` diferentes podem passar as duas. A deduplicação por chave é atômica (índice único); o limite não.
- Cancelar não recolhe um envio já em curso; o executor só percebe ao salvar.
- Falha `unknown` não notifica o dono (o `cron.ts` faz isso para mensagens agendadas). Hoje só aparece no status da execução.
- Pausa humana: `quemPodeEnviar` devolve `retomar: true` com pausa vencida; a automação apenas segue, não regrava o estado.
- `claimExpiresAt` de 5 min: um envio que demore mais que isso por lentidão do provedor poderia ser tomado por outra instância. A reserva `claimed` do passo ainda impede reenvio, mas a execução falharia como `unknown`.
- Execução usa a sessão do fluxo; se a sessão for removida, a execução falha na resolução do provedor (transitória, esgota).

## Roteiro de staging

1. Revisão do João do schema e da migração; backup; aplicar só no staging por migração revisada (não `db push`).
2. `AUTOMACOES_ATIVAS=true` apenas no staging.
3. Criar fluxo com `texto -> espera 1 min -> etiqueta -> fim` numa sessão de teste; publicar (conferir recusa de rascunho com ciclo ou órfão); iniciar para um número próprio; conferir passos e etiqueta; repetir o início (deve dar `duplicada`).
4. Cancelar durante a espera; assumir a conversa como humano durante a espera (deve cancelar sem enviar); opt-out (SAIR).
5. Duas instâncias com a mesma execução vencida: uma envia, a outra `nao_reivindicada`; matar o processo logo após enviar e conferir `unknown` sem reenvio.
6. Sessão Cloud: texto fora da janela deve falhar como `policy`; template deve sair.

## Rollback

Rollback funcional: desligar `AUTOMACOES_ATIVAS` (o worker para; as rotas ficam inertes) e, se preciso, reverter só o código que usa as tabelas. **Preservar os models aditivos no `schema.prisma`**: reverter os commits do schema também remove os models, e o Dockerfile continua rodando `prisma db push`, que então exige confirmação de perda de dados e impede o servidor de iniciar. Remover as tabelas é uma operação separada, só com os workers parados, dados reconciliados e backup restaurável testado; os `DROP` respeitam a ordem das FKs, mas isso não os torna seguros (apagam execuções e registros antirreenvio).

## Pendências de schema

- Exige revisão do João antes do merge (regra aditiva do plano de migração).
- Gerar e revisar o SQL (4 tabelas, uma FK interna por relação, índices únicos `[flowVersionId, contactKey, dedupeKey]`, `[flowId, version]`, `[runId, seq]`); `contactKey VARCHAR(191)`, `dedupeKey VARCHAR(120)`.
- Decidir se os índices e `onDelete` (Step e Version em cascata, Run sem cascata) valem; arquivar fluxo é por `status`, não por exclusão.

## Ajustes pós-revisão

Revisão independente aprovou com ajustes; cada ponto foi conferido no código antes de corrigir.

### Mudanças

1. **Sessão do fluxo.** `criarFluxo` resolve a sessão (id interno primeiro, depois nome) e grava sempre `Session.sessionId` (nome). Sessão inexistente: `sessao_invalida` (rota devolve 404).
2. **Acesso à sessão rechecado.** `iniciarRun` chama `canAccessSession(userId, role, flow.sessionId)` (403 se negado). O executor consulta `deps.temAcesso(userId, sessionId)` (dono ou `SessionAccess`) ao retomar e antes de cada envio; sem acesso, cancela com `motivoFim = sessao_invalida`. Cobre acesso revogado e sessão recriada por outro usuário com o mesmo nome. Efeito colateral aceito: um SUPERADMIN que criou fluxo em sessão alheia sem ser dono nem ter `SessionAccess` tem as execuções canceladas pelo executor.
3. **Disparo manual em massa.** (a) `contactKey` precisa existir em `Contact` da sessão (`jid` ou `remoteJidAlt`), senão `contato_desconhecido` (400). (b) Teto de inícios na última hora: por usuário (`AUTOMACOES_MAX_INICIOS_HORA_USUARIO`, padrão 60) e por fluxo (`AUTOMACOES_MAX_INICIOS_HORA_FLUXO`, padrão 30); excedido devolve `limite_taxa` (HTTP 429). (c) Baileys: antes do envio o executor consulta `gateEnvio` (Modo Seguro, `safeGate`; fora do horário a execução fica `waiting` até a janela abrir, sem gastar tentativa) e `processarProntas` espaça os envios com `humanDelayMs`/`batchPauseMs` (`espacar`) e respeita um orçamento de tempo por rodada (4 min no worker; o restante fica para a próxima). Cloud API não sofre gate nem espaçamento.
4. **Execução envenenada.** Coluna aditiva `AutomationRun.claimsSemProgresso` (commit `db:` separado). `claimRun` incrementa; qualquer `salvar` bem-sucedido zera. Acima de 5 reivindicações seguidas sem salvar nada, a execução falha como `permanent` ("execução travada ..."), antes de tocar a definição.
5. **Esperas x prazo.** `ESPERA_MAX_MS = TIMEOUT_TOTAL_MS` (7 dias). O validador também rejeita fluxo cujo caminho mais longo some esperas acima de 7 dias (ramos alternativos não somam; arestas de retorno de ciclo contam zero, atalho documentado no código).
6. **Menores.** `CLAIM_TTL_MS` no lugar de `5 * 60_000` em `salvar`. `ctx.tentativas` zera ao avançar de nó. `publicarFluxo` usa `$transaction` (versão e ponteiro juntos; retentativa em colisão de número mantida). Nova rota `PUT /api/automacoes/[id]` (`{ draft }`) autenticada e escopada por `userId`. `cancelarRunsDoContato` foi movida para `cancelamento.ts` (re-exportada por `servico.ts`) e passa a ser chamada por `addOptOut` (opt-out cancela as execuções ativas do contato, melhor esforço).

### Resultados reais

- `npx prisma generate`: ok. `npm run typecheck`: sem erros.
- `npm test` (suíte completa): 139 arquivos, 2339 testes, todos passando (antes: 137 arquivos, 2311). Novos: `pos-revisao.test.ts` (executor e validador), acréscimos em `servico.test.ts`, `src/app/api/automacoes/route.test.ts` (401 sem login, isolamento/IDOR em iniciar, publicar, editar rascunho, ver e cancelar execução, 403/201 na criação, 400 contato desconhecido, 429 taxa).
- `eslint` nos arquivos alterados: sem erros nem avisos.
- `npm run build` (variáveis fictícias só no processo): ok.

### Limitações e não verificado

- **`AUTOMACOES_ATIVAS` NÃO deve ligar em produção** sem validar em staging o conjunto acima: gate do Modo Seguro, espaçamento entre envios, tetos por hora e cancelamento por acesso revogado. Nada disso foi exercitado contra Baileys, Cloud, nem banco reais.
- Colunas novas (`claimsSemProgresso`) não foram aplicadas a banco algum; o repositório não tem pasta de migrações, então o SQL aditivo precisa ser gerado e revisado antes do deploy.
- "Humano assumiu" não ganhou gancho de cancelamento imediato: os pontos que pausam a conversa são vários (painel, IA das lojas, atendente). O executor cancela na retomada e antes de cada envio via `quemPodeEnviar`, então a limitação é só a latência (a execução fica `waiting` até acordar). Opt-out cancela na hora, casando pelo `jid` recebido; outra forma do mesmo número cai na checagem do executor.
- Teto por hora conta execuções criadas, não envios; o espaçamento só vale com Anti-Spam ligado na sessão (padrão: ligado sem configuração salva).
- Nenhum teste contra Prisma real: rotas e serviço foram testados com banco falso/mocks.

## Correções da revisão Codex

Achados da revisão independente (cinco do motor e depois #3, #11, #12, #13 e #2), todos confirmados no código e corrigidos (um commit por achado ou par coeso, cada um com teste de regressão que falhava antes):

- **Resultado desconhecido nunca é reenviado.** Um último passo `unknown` agora encerra a execução como `unknown` sem enviar, mesmo que a gravação do fim da execução tenha falhado antes. As gravações do passo e da execução continuam em chamadas separadas (não há transação entre elas); o passo `unknown` é o registro durável que impede o reenvio.
- **Cancelamento impede o envio.** A reserva do envio (`abrirPasso` com `posse`) é uma transação que confere execução `running` e dona e só então cria o passo `claimed`. Cancelar antes da reserva, ou perder a posse, impede a chamada ao provedor.
- **Políticas dos outros envios.** Antes de cada envio o executor aplica `assertCanSend` (dono da sessão) e "só quem já interagiu", reaproveitando as funções do agendador, e registra o consumo depois do envio; falha ao registrar não derruba nem reenvia.
- **Espaçamento por mensagem.** O espaçamento (e a contagem de lote) ocorre antes de cada mensagem posterior à primeira da mesma execução, renovando a posse a cada `RENOVACAO_CLAIM_MS`, e as checagens de cancelamento rodam depois da espera.
- **Pausa humana da IA Cloud.** Em sessão Cloud a conversa também é consultada em `IaConversa` por contato. Limitação: `IaConversa` não tem `sessionId`, então a busca vale para todas as lojas do contato, o que só é exato com uma conta Meta (decisão do dono).

- **#3 Perda da trava (JobLock).** `startJobLock`/`withJobLock` agora usam um token por aquisição e entregam a posse (`signal` e `ativa()`): renovação com `count` 0 ou sem confirmação por um TTL marca a posse como perdida. Disparo em massa, agendador de mensagens, follow-up e publicação social param de iniciar novos envios quando a posse se perde; o worker de automações só deixa de iniciar a rodada (o executor não foi alterado, e o claim por execução segue como garantia).
- **#11 Número de envio Cloud.** `numeroDeEnvioPertence` confere o número contra `WHATSAPP_CLOUD_PHONE_MAP` mesmo com uma só sessão; a compatibilidade implícita vale só sem mapa.
- **#12 `dedupKey` de resultados.** A chave virou sha256 hex dos identificadores exatos (`r:` + 64 caracteres), então "PedidoA" e "pedidoa" não colidem na collation `utf8mb4_unicode_ci`. A coluna (`VARCHAR(191)`) comporta a chave: sem mudança de schema. Linhas já importadas com a chave antiga não casam com a nova (reimportar o mesmo arquivo as duplicaria uma vez; se já houver importações, avaliar antes de aplicar).
- **#13 ISO completo na importação.** `lerData` valida ano, mês, dia (com bissexto), hora, minuto, segundo e offset antes de converter; `2026-02-31T12:00:00-03:00` agora é rejeitada por linha.
- **#2 Rollback documentado.** O rollback funcional preserva os models aditivos no `schema.prisma` (reverter só o código ou desligar `AUTOMACOES_ATIVAS`/`RESULTADOS_ENABLED`); reverter o schema faz o `prisma db push` do Dockerfile exigir confirmação de perda de dados e impedir o servidor de iniciar. Remoção de tabelas é operação separada, com workers parados, dados reconciliados e backup restaurável testado. Ajustados também o SQL aditivo, o plano de migração e o relatório final do Growth OS.

- **Ajustes da segunda passada.** (a) Com `WHATSAPP_CLOUD_PHONE_MAP` definido, número de envio fora do mapa bloqueia a IA (`consumer.ts`) e o aviso de pedido (`order-notifier.ts`); os dois agora registram "número de envio fora do mapa explícito" com o id da sessão, sem valores de variáveis. **Antes do deploy, conferir nos envs que `META_WA_PHONE_NUMBER_ID` consta no mapa**, senão a IA e o aviso ficam bloqueados (só aparece o aviso no log). (b) `startJobLock` calcula `validoAte` a partir do mesmo instante gravado em `expiresAt`, então `ativa()` não sobrevive ao vencimento real da linha. (c) `lerData` calcula o último dia do mês com `setUTCFullYear`, sem o mapeamento de ano 0 a 99 para 1900+ do `Date.UTC`. (d) Disparo em massa: o bloco de mensagens agendadas ("deferred") com trava perdida foi analisado e não procede: `deferredFrom` só é definido no portão de segurança e `lockLost` só no teste de posse, ambos seguidos de `break`, então nunca coexistem; sem teste possível, sem mudança.

### Limitações conhecidas

- `IaConversa` não tem `sessionId`: a pausa humana cruza lojas (conservador).
- O worker de automações não tem posse da trava no executor (só deixa de iniciar a rodada).
- Os nós `etiqueta` e `transferirHumano` não têm reserva atômica.
- P2002 em `abrirPasso` com posse não é tratado como corrida.
- `dedupKey` antiga de resultados não casa com a nova (ver #12).

Não verificado: nada foi exercitado contra Prisma, Baileys ou Cloud reais; a transação de reserva só foi testada com o banco em memória (a versão Prisma foi apenas compilada).
