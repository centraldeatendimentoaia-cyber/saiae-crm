# Sprint 6 (Editor visual e canais sociais): relatório

Branch `feat/sprint6-editor-canais`, a partir do Sprint 5 (contém Sprints 2, 3 e 5). Nada foi implantado, enviado, publicado nem testado contra Meta/WhatsApp reais. Schema: só o commit aditivo `db:` do modelo `AutomationTriggerEvent` (ver "Ajustes pós-revisão"; sem db push). ChatbotX serviu só como referência de padrões (rascunho x publicado, códigos de validação por nó, poucos nós primitivos); nenhum código dele foi usado.

## Decisões

- **Núcleo puro e testável, UI fina.** Conversão grafo/JSON, validação por nó e simulador são módulos sem React em `src/modules/automacoes/editor/`. A UI só desenha e chama a API.
- **Layout e gatilho dentro do próprio JSON** (`layout`, `trigger`), campos extras que o validador do motor ignora. Sem schema novo; a versão publicada guarda o gatilho (o roteador lê dela).
- **Mesma validação no cliente e no servidor**: o editor chama `validarDefinicao` do motor; o servidor já a roda ao publicar (teste novo: 400 com órfão e ciclo, nenhuma versão gravada).
- **Simulador roda o MESMO `executarRun`** sobre armazenamento em memória, provedor fictício e relógio fictício (espera avança o relógio). Teste prova que o módulo não importa Prisma/provedores e não usa `fetch`.
- **Gatilhos Meta desligados por padrão e diagnosticáveis.** Cada gatilho só dispara com: flag ligada, TODAS as permissões exigidas presentes, webhook configurado e provedor de envio do canal existente. Hoje as permissões do OAuth (`pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish, business_management`) não incluem mensagens nem comentários, e o executor só envia por WhatsApp. Logo NENHUM gatilho pode ficar habilitado em produção; a rota de diagnóstico diz o motivo. Nada simula sucesso.
- **Acessibilidade**: nós focáveis por Tab (React Flow), setas movem, Delete remove; como arrastar uma ligação não é viável por teclado, o painel de propriedades tem um `select` "Próximo nó / Se verdadeiro / Se falso" e há lista de nós com botões. Erro aparece por texto e ícone, não só por cor. Estados vazio, carregando e erro nas duas telas; `aria-live` na validação e no simulador; layout responsivo (painéis empilham abaixo de `lg`).

## Dependências e licenças

`@xyflow/react` **12.12.0** (exato, publicado em 2026-09-24, mais de 7 semanas), licença **MIT**. Dependências conferidas em `node_modules`: `@xyflow/system` 0.0.83 (MIT), `classcat` 5.0.5 (MIT), `zustand` 4.5.7 (MIT), `d3-drag`, `d3-selection`, `d3-zoom` 3.0.1 e `d3-interpolate` 3.0.2 (ISC). Todas permissivas. Não verificada auditoria de vulnerabilidades (`npm audit`).

## Arquivos

Núcleo (`src/modules/automacoes/editor/`): `grafo.ts`, `validacao.ts`, `simulador.ts`, `editor.test.ts`.
Gatilhos (`src/modules/automacoes/gatilhos/`): `catalogo.ts` (catálogo, flags, diagnóstico), `eventos.ts` (normalização do webhook), `canal.ts` (janelas e classificação de erros), `roteador.ts` (regras), `real.ts` (Prisma), `gatilhos.test.ts`.
API: `src/app/api/social/webhook/route.ts` (+ teste), `src/app/api/automacoes/gatilhos/diagnostico/route.ts`, `GET /api/automacoes/[id]` (novo), `obterFluxo` em `servico.ts`; `src/proxy.ts` (+1 rota pública, protegida por token e HMAC).
UI: `src/app/dashboard/automacoes/page.tsx`, `.../[id]/page.tsx`, `src/components/automacoes/{editor-fluxo,no-fluxo,propriedades-no,painel-simulador,painel-gatilho}.tsx`, item de menu em `nav-items.ts`.

## Gatilhos, flags e permissões Meta necessárias

| Gatilho | Flag | Permissões exigidas | Campo do webhook |
|---|---|---|---|
| Instagram DM com palavra-chave / qualquer DM | `AUTOMACOES_GATILHO_IG_DM` | `instagram_manage_messages`, `pages_messaging` | `messages` |
| Instagram comentário em post (resposta privada) | `AUTOMACOES_GATILHO_IG_COMENTARIO` | `instagram_manage_comments`, `instagram_manage_messages`, `pages_messaging` | `comments` |
| Messenger DM com palavra-chave / qualquer DM | `AUTOMACOES_GATILHO_MSGR_DM` | `pages_messaging` | `messages` |
| Messenger comentário em post da Página | `AUTOMACOES_GATILHO_MSGR_COMENTARIO` | `pages_read_user_content`, `pages_manage_metadata`, `pages_messaging` | `feed` |

Variáveis do webhook: `SOCIAL_META_APP_SECRET` (HMAC) e `SOCIAL_WEBHOOK_VERIFY_TOKEN` (GET). As permissões acima exigem App Review da Meta (as listadas dependem do nível de acesso do app; confirmar no painel da Meta, não foi consultado).

Regras implementadas no roteador: deduplicação por id do evento; isolamento (evento da conta só olha fluxos do dono dessa conta e cujo gatilho aponta para ela); opt-out (DM "SAIR"/"PARAR" grava e bloqueia; opt-out gravado bloqueia); janela de DM 24 h e de resposta privada 7 dias; uma resposta privada por comentário e conta; contexto (`comentario_id`, `post_id`, `autor_id`, `janela_ate_ms`, `canal`) vai nas variáveis iniciais da execução e sobrevive às esperas. Erros da Graph API são classificados por `classificarErroCanal` usando `send-failure` (fora da janela = `policy`, limite de taxa = `transient`, token/permissão = `permanent` com `reconectar`, falha interna = `unknown`, nunca reenvia).

## Testes e resultados REAIS

| Item | Resultado |
|---|---|
| `npm run typecheck` | OK, sem erros |
| `npm test` (suíte completa) | 142 arquivos, 2382 testes, todos passando (antes: 139 / 2339). Novos: `editor.test.ts` (16), `gatilhos.test.ts` (19), `webhook/route.test.ts` (6), +2 em `automacoes/route.test.ts` |
| lint (`eslint` em automacoes, componentes, páginas e rotas novas) | sem problemas |
| `npm run build` (env fictício só no processo) | OK; rotas `/dashboard/automacoes`, `/dashboard/automacoes/[id]`, `/api/social/webhook`, `/api/automacoes/gatilhos/diagnostico` geradas |

Cobertura: conversão grafo/JSON (ida e volta idempotente), validação por nó (destino inexistente, espera acima do limite, órfão, ciclo com e sem espera), simulador (caminho, relógio, mensagens, janela fechada, loop com espera, prova de que não há envio), palavra-chave/DM/comentário com payloads sintéticos, deduplicação, isolamento entre contas e usuários, janelas, opt-out, flag/permissão/provedor ausentes (nada dispara nem toca o banco), HMAC do webhook, diagnóstico (sem vazar segredo), erros de canal.

Nota de ambiente: o `npm ci` do worktree deixou `swagger-jsdoc/node_modules/doctrine/lib/utility.js` sem extrair (erro de tar no Windows); recopiei o arquivo do pacote oficial só no `node_modules` local. Não afeta o repositório.

## NÃO verificado

- **Editor no navegador**: NÃO TESTADO visualmente. Subir o dev exige login (NextAuth) e MySQL; sem banco real não foi viável. Compila e passa em typecheck/lint/build; o comportamento do canvas (arrastar, Tab, Delete, setas, ligar pelo painel) e o contraste não foram observados. Não há infraestrutura de teste de componente no projeto (vitest só em ambiente node), então só a lógica pura é testada.
- Nada contra Meta real: webhook, assinatura de apps reais, entrega de eventos, permissões efetivas.
- Nenhum envio por Instagram/Messenger: não existe provedor desses canais no executor; `depsReais().iniciar` recusa (`canal_sem_provedor`) de propósito.
- Persistência real da deduplicação entre instâncias (hoje em memória, ver pendências).
- `npm audit` das dependências novas.

## Roteiro de homologação (manual, em staging)

1. Aplicar o schema do Sprint 5 no staging (já pendente) e subir com env do staging.
2. `/dashboard/automacoes`: criar fluxo; abrir o editor; adicionar texto, espera, condição, etiqueta e fim; ligar pelo canvas E pelo painel; mover só com teclado (Tab, setas); remover nó com Delete.
3. Clicar Validar com um nó órfão, um ciclo sem espera e uma espera de 8 dias: cada nó deve mostrar "N problema(s)" e a lista; Publicar deve ser recusado (cliente e servidor).
4. Simular: caminho, mensagens que seriam enviadas, tempo das esperas; conferir que nenhuma mensagem sai e nada é gravado em `AutomationRun`.
5. Salvar rascunho, recarregar, conferir posições e gatilho; publicar; iniciar manualmente para um número próprio (Sprint 5).
6. `GET /api/automacoes/gatilhos/diagnostico` logado: todos os 6 gatilhos devem aparecer com estado e motivo (esperado hoje: `desabilitado_flag`; com a flag, `bloqueado_permissao`).
7. Só depois da revisão do app na Meta: cadastrar o webhook `/api/social/webhook` com o verify token, assinar os campos da tabela, ligar UMA flag no staging e testar DM e comentário com conta de teste.

## Rollback

Nenhuma flag nova está ligada; os gatilhos ficam inertes. A rota `/api/social/webhook` responde 503/403 sem as variáveis. Reverter os commits do Sprint 6 remove UI, rotas e a dependência (`npm uninstall @xyflow/react`); não há dado nem schema a desfazer.

## Pendências

- **Schema**: modelo aditivo `AutomationTriggerEvent` (chave `key` única) já no `schema.prisma`, MAS a tabela precisa ser criada no banco (db push/migrate, fora deste trabalho) ANTES de ligar qualquer flag de gatilho: sem ela a reserva de evento falha e nada dispara. Falta rotina de retenção (apagar linhas antigas; índice em `createdAt` já existe). Opt-out social reaproveita `OptOut` com `sessionId = social:<accountId>` e `phoneKey` = id do remetente (sem coluna nova).
- **Provedor de envio Instagram/Messenger** no executor (DM e resposta privada por `comment_id`, conferindo `janela_ate_ms` antes de enviar e usando `classificarErroCanal`); sem isso nenhum gatilho habilita. `AutomationRun` hoje exige `Contact` do WhatsApp; `contactKey` social (`instagram:<id>`) vai precisar de outro caminho em `iniciarRun`.
- App Review da Meta e ampliar `SCOPES` em `oauth.ts` (reconectar as contas depois).
- Editor: renomear id de nó, desfazer/refazer, condições compostas só por JSON, validação do bloco `trigger` ao publicar, exibir no editor aviso de gatilho sem conta.

## Ajustes pós-revisão

Mudanças (revisão independente, nenhum bloqueante; viram críticos ao ligar provedor/flags):

1. **Reserva atômica**: `reservar` agora faz `create` em `AutomationTriggerEvent` (unique em `key`); P2002 = já reservado (false); outro erro propaga e não marca a chave. O Map em memória virou só cache (consultado antes, gravado depois do sucesso). Vale para o dedupe de evento e para "uma resposta privada por comentário".
2. **Trigger validado no servidor** (`gatilhos/validacao.ts`): zod estrito (tipo e canal no enum, accountId string, `palavras` até 20 de até 100 caracteres, `postId` até 100) e lookup de `SocialAccount` por id, userId e provedor do canal. Roda no publicar e no PUT do rascunho (`definicao_invalida`, HTTP 400 com detalhes no PUT). O roteador usa `Array.isArray`/filtro de tipo em `palavras` e isola erro por fluxo (match e início): um fluxo ruim não aborta os outros.
3. `created_time` do Messenger: abaixo de 1e11 é segundos e é multiplicado por 1000.
4. Webhook: corpo lido por `getReader()`, aborta acima de 1 MB (413) mesmo chunked sem content-length.
5. Webhook: no máximo 100 eventos por requisição, processados em lotes de 5.
6. Menores: id de nó `__proto__|constructor|prototype` recusado no validador; `editor/grafo.ts` usa `Object.create(null)` e `Object.hasOwn`; teto de 100 posições em `layout` (PUT e publicar); `key={sel.id}` em `<PropriedadesNo>`.

Resultados REAIS: `prisma generate` ok; `npm run typecheck` sem erros; `npm test` 144 arquivos, 2404 testes passando; eslint nos arquivos alterados sem erros; `npm run build` ok (env fictício só no processo). Testes novos: `gatilhos/endurecimento.test.ts` (corrida, reinício, P2002, trigger, isolamento por fluxo, segundos Unix, ids perigosos) e `api/social/webhook/limites.test.ts` (413 em chunked, teto de 100 eventos, lotes de 5).

NÃO verificado / não feito:
- A tabela `AutomationTriggerEvent` não existe em nenhum banco (sem db push); a reserva só foi testada com Prisma simulado, não com Postgres real nem com duas instâncias.
- Filtro de conta desconectada/token expirado em `contasPorExterno`: `SocialAccount` não tem campo de status, então não foi feito (exigiria schema novo).
- Sem teste de integração do PUT/publicar com layout acima do teto (a regra está em `servico.ts`, coberta só por leitura).
- Reordenação de `package.json`: a diferença contra a base misturou mudanças da main; não revertida por não ser trivial.
- Sem retenção/limpeza das linhas de `AutomationTriggerEvent`.
