# Sprint 7 (Resultados e piloto): relatório

Branch `feat/sprint7-resultados-piloto`, a partir do Sprint 6 (contém Sprints 2, 3, 5 e 6). Nada foi implantado, enviado nem testado contra Meta, Google ou agenda reais. Schema: só o commit aditivo `db:` do modelo `ResultEvent` (sem db push).

## Decisões

- **Reaproveitar o que existe.** Origem vem de `ConversaOrigem` (marcador de anúncio na 1ª mensagem), das etiquetas (`Label`/`ChatLabel`) e de `VendaIA`; leads, conversas e respostas são derivados de `Message` na leitura. Só dados que o CRM não tem (agenda, comparecimento, vendas externas) ganharam tabela: `ResultEvent`.
- **Confiança por evento e por origem**: `confirmado` (registro autoritativo), `inferido` (regra descrita), `desconhecido`. O painel mostra as três partes lado a lado, nunca soma sem rótulo, e conta à parte os contatos com "origem não identificada".
- **Regras de origem** (`origem.ts`, por prioridade): marcador de anúncio = anúncio confirmado (campanha específica segue desconhecida); origem declarada em planilha = inferida; etiqueta de origem = inferida; `ConversaOrigem = organico` = orgânico inferido ("ausência de marcador"); senão desconhecida. O sistema nunca afirma que uma campanha causou uma venda.
- **Venda da atendente IA = inferida** (não conferida com caixa/agenda); venda importada = confirmada.
- **Funil por evento no período, não por coorte**: pessoas distintas por etapa (um contato conta uma vez por etapa; vale o evento de maior confiança). Está escrito na tela.
- **Importação controlada**: CSV (`;` ou `,`) ou JSON colado/enviado no navegador, até 1 MB e 5000 linhas, validação linha a linha (tipo, telefone, data real, origem, valor, data futura para comparecimento/venda), duplicata no arquivo descartada, idempotência por `@@unique([userId, sessionId, dedupKey])` + `createMany skipDuplicates` (chave = sha256 hex dos identificadores exatos tipo+contato+referência, prefixo `r:`; sem referência, hash de tipo+contato+data, prefixo `h:`; o hash evita colisão por caixa na collation do banco). Só o dono da sessão importa; o evento é gravado com o `userId` dono da sessão.
- **CSV sem injeção de fórmula**: célula que começa com `=`, `+`, `-`, `@`, tab ou CR recebe apóstrofo.
- **UI**: `/dashboard/resultados` com `select` e inputs nativos rotulados, tabela com `caption` e `th scope`, selos com texto e símbolo (não só cor), `aria-live` para carregando/erro/resultado, `role="alert"` no erro, estados vazio/erro/carregando, layout com rolagem horizontal da tabela em tela estreita.

## Arquivos

Núcleo (`src/modules/resultados/`): `tipos.ts`, `origem.ts`, `funil.ts`, `agenda.ts` (parser), `csv.ts`, `carregar.ts` (Prisma), `resultados.test.ts`.
API: `src/app/api/resultados/[sessionId]/route.ts` (GET JSON/CSV, filtros `de`, `ate`, `origem`, `formato`), `.../importar/route.ts` (POST), `route.test.ts`.
UI: `src/app/dashboard/resultados/page.tsx`; item "Resultados e origem" em `nav-items.ts`.
Schema: `prisma/schema.prisma` (`ResultEvent`). Docs: `plano-piloto-lavi.md` e este relatório.

## Testes e resultados REAIS

| Item | Resultado |
|---|---|
| `npx prisma generate` | OK |
| `npm run typecheck` | sem erros |
| `npm test` (suíte completa) | 146 arquivos, 2428 testes passando (antes 144 / 2404; novos: 24). Uma execução intermediária registrou 1 falha em teste que não identifiquei (a saída foi truncada); duas execuções seguintes passaram 100%. Possível flake preexistente, não investigado |
| eslint em módulo, rotas, página e nav | sem problemas (0 erros, 0 avisos) |
| `npm run build` (env fictício só no processo) | OK; `/dashboard/resultados`, `/api/resultados/[sessionId]` e `.../importar` geradas (há ruído `prisma:error` por não haver banco no build) |

Cobertura dos testes novos: rótulos de confiança e regra de inferência (origem), funil (vazio, contagem de pessoas, separação confirmado/inferido, desconhecidos, filtro por origem), CSV (injeção de fórmula, cabeçalho/BOM), importação (fixture sintética, idempotência, lixo linha a linha, arquivo vazio/grande/sem cabeçalho/JSON ruim, JSON em lista ou `{eventos}`), rotas (401, 403 de acesso cruzado sem consulta ao banco, escopo por sessão e userId em todas as consultas, painel vazio, origem desconhecida, validação de parâmetros, só o dono importa, gravação sob o userId do dono, 2ª importação sem duplicar).

## NÃO verificado

- **Nada rodou contra banco real**: `ResultEvent` não existe em nenhum banco; `groupBy ... having` sobre `Message`, `createMany skipDuplicates` e o filtro de `ChatLabel` pela relação foram exercitados só com Prisma simulado. Validar em staging com MySQL.
- **Página no navegador**: NÃO TESTADA visualmente (sem login/banco); só compila, passa typecheck, lint e build. Contraste, foco e leitor de tela não foram observados.
- Desempenho dos `groupBy` em sessões grandes (período até 92 dias).
- Casamento do telefone da planilha com o jid real (9º dígito, LID): só normalização por regra.
- `npm audit`.
- Nenhuma integração com agenda, Meta ou Google; atribuição de campanha/post específico não existe (só categorias).

## Riscos

- Lead pode ser cliente antigo se a retenção apagou o histórico (inferência declarada na tela).
- Origem "orgânico" é uma ausência de marcador, rotulada como inferida.
- Etiqueta de origem depende do nome (regex em `origemDaEtiqueta`); nomes fora do padrão caem em "não identificada".
- Importação confia no que o usuário envia: o evento é "confirmado" quanto à existência no arquivo, não verificado contra a agenda.

## Roteiro de homologação

Ver `plano-piloto-lavi.md` (seções 1 e 2). Resumo: backup, schema em staging, painel vazio, conferência manual de 10 contatos, origem, importação sintética e depois real, isolamento entre dois usuários, CSV no Excel.

## Rollback

Reverter os commits do Sprint 7 remove painel, rotas e menu. Os dados de `ResultEvent` ficam inertes; apagar por `fonte`/`createdAt` em staging se uma importação errada precisar sair. Sem flag nova.

## Pendências de schema

- `ResultEvent` (commit `db:` 26be5ee): aditivo, não aplicado; precisa de revisão do João e do SQL gerado (o repositório não tem `prisma/migrations`) e de backup antes de qualquer `db push`.
- Índice em `ResultEvent` por `userId, sessionId, ocorridoEm` já previsto; sem rotina de retenção.
- Futuro: campo de campanha/anúncio estruturado em `ConversaOrigem` (hoje só `anuncio|organico`), e `AutomationRun` para contatos sociais (herdado do Sprint 6).

## Ajustes pós-revisão

Revisão independente aprovou com ajustes. Requisito central mantido: nunca somar inferido com confirmado sem rótulo e nunca afirmar causalidade.

### Mudanças
- **B1 (confiança da origem):** o selo "confirmado" de um evento confirma o evento, não a origem. `Funil.porOrigem` agora é uma lista por (origem, confiança da origem): "Orgânico (origem inferida)" e "Anúncio (origem confirmada)" nunca se misturam. A tela mostra a confiança ao lado de cada origem e o CSV ganhou a coluna `confianca_da_origem`. Teste: lead orgânico nunca aparece como origem confirmada (funil, CSV e JSON da rota).
- **B2 (importação):** eventos importados são gravados `inferido`; só `confirmado` com a coluna `fonte_conferida = sim` (validada: sim/nao/vazio, outro valor rejeita a linha). "Importação" saiu do texto de "registro autoritativo". Registros antigos sem lote marcados `confirmado` são lidos como inferidos.
- **B3 (sessão):** `resolverSessao` (novo `sessao.ts`) usa a ordem de `canAccessSession`: id primeiro, depois nome. Usado em `GET` e `importar`. Teste de colisão id x nome.
- Conversas respondidas: agora inferidas (exige mensagem enviada posterior à primeira recebida no período).
- Origem declarada em planilha vale em qualquer período (consulta própria, `orderBy ocorridoEm asc, id`), deterministica.
- Etiqueta: `\b(...|meta|facebook)\b` (não casa mais "Metade"); etiquetas de origem em conflito resultam em "origem não identificada".
- `dedupKey` inclui o contato quando há referência; repetidas no arquivo sem referência viram aviso com contagem (`repetidasNoArquivo`, `repetidasSemReferencia`), não somem em silêncio.
- `importacaoId` (lote) no `ResultEvent` (commit `db:` separado `104d330`), gravado na importação; `DELETE /api/resultados/[sessionId]/importar?importacaoId=` desfaz o lote (só dono, escopado por userId e sessão); botão "Desfazer esta importação" no painel.
- Exclusão: `apagarResultadosDaSessao`/`apagarResultadosDoUsuario` chamadas na exclusão de sessão (rota e `manager.deleteSession`) e de usuário. Retenção: `RESULT_EVENT_RETENTION_DAYS` (padrão 365, 0 desliga) em `retention.ts`.
- Flag `RESULTADOS_ENABLED` (desligada por padrão): as rotas `/api/resultados/*` respondem 404 sem ela. A entrada no menu continua visível (a página mostra o erro).
- N+1: as 4 consultas por lote de 500 contatos agora rodam em `Promise.all`. Os `groupBy` seguem sem índice dedicado.
- Menores: `content-length` checado antes de `request.text()`; avisos de encoding inválido (caractere U+FFFD, típico de Windows-1252) e de aspa aberta no CSV; valor "1.234" rejeitado como ambíguo; contatos importados sem nenhuma conversa na sessão contados e mostrados no painel; `title=` dos selos removido e substituído por legenda visível.
- Plano do piloto: P10 (não fazer deploy do branch em produção), P11 (flag), P12 (base legal), P13 (EXPLAIN), metas numéricas, teste com `SessionAccess` e admin na etapa 5, nova seção 8 (LGPD e retenção).

### Resultados REAIS desta rodada
| Item | Resultado |
|---|---|
| `npx prisma generate` | OK |
| `npm run typecheck` | sem erros |
| `npm test` (2 execuções completas) | 146 arquivos, 2446 testes, 100% nas duas. O flake relatado antes NÃO se repetiu em 2 execuções; sem causa identificada (não investigável sem a saída da falha) |
| eslint nos arquivos alterados | 0 erros novos. Preexistentes: `any` em `users/[id]/route.ts:43` e `isAdmin` não usado em `sessions/[sessionId]/settings/route.ts:5` |
| `npm run build` (env fictício só no processo) | OK |

### NÃO verificado
- Nada rodou contra banco real (mesmo ponto acima). Em especial `importacaoId`, `orderBy` composto e `Promise.all` em lote só com Prisma simulado.
- **Desempenho dos `groupBy` de `Message`** (4 por requisição, período até 92 dias) e da consulta de `ResultEvent` por contato: sem `EXPLAIN` real. Exigido em staging (P13) antes de liberar para mais de uma sessão.
- Página no navegador e acessibilidade (legenda visível, leitor de tela).
- Casamento telefone da planilha x jid (LID, 9º dígito). O painel só conta quantos importados não têm conversa.
- Exclusão de sessão/usuário nas rotas reais: a cascata foi testada na função, não ponta a ponta.
- Pedido de exclusão por telefone (titular) não tem tela.

### Schemas pendentes
- `ResultEvent` (`26be5ee`) e o campo `importacaoId` com índice `(userId, sessionId, importacaoId)` (`104d330`): aditivos, não aplicados; o SQL precisa de revisão e backup antes de qualquer `db push`. Sem `prisma/migrations` no repositório.
- Possível índice em `Message` para o `groupBy` (decidir após o EXPLAIN).
