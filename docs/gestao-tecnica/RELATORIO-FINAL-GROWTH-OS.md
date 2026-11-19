# Sai aê Growth OS: relatório final

Data: 2026-11-13. Base de produção: `origin/main` = `48cb963` (#72). Todos os sprints estão implementados e revisados **apenas no local**. Nada foi enviado ao remoto, implantado, aplicado em banco ou testado contra Meta, WhatsApp, Google ou agenda reais.

## 1. Visão geral

| Sprint | Entrega | Worktree / branch | Commit final | Revisão independente |
|---|---|---|---|---|
| 0 | Baseline, arquitetura, plano de migração, incidente de credenciais, revalidação dos achados, contrato agência-CRM, referência ChatBotX | `saiae-crm-growth` / chore/growth-os-base | docs sem commit | n/a |
| 1 | Socket.IO autenticado e autorizado por sala, CORS por Origin, revalidação, base URL do OAuth Meta | `saiae-crm-sprint1` / fix/sprint1-socket-oauth | f9fa3e2 | Aprovado com ajustes, corrigidos |
| 2 | Claim atômico em agendamentos, classificação de falhas, resultado desconhecido sem reenvio, trava de broadcast, aviso-worker | `saiae-crm-sprint2` / fix/sprint2-confiabilidade-mensagens | 5423cc0 | Aprovado com ajustes, corrigidos |
| 3 | Sessão Cloud por número/barraca, isolamento de `canAccessSession`, `quemPodeEnviar` | `saiae-crm-sprint3` / feat/sprint3-multiempresa | 737fd27 | Aprovado com ajustes, corrigidos |
| 4 | Importação idempotente agência→CRM, bloqueio editorial, retorno de estado, scripts da agência | `saiae-crm-sprint4` / feat/sprint4-agencia-crm | 8da3ad7 | Aprovado com ajustes, corrigidos |
| 5 | Motor de automações com fluxos JSON | `saiae-crm-sprint5` / feat/sprint5-motor-automacoes | 08b9fc8 | Aprovado com ajustes, corrigidos |
| 6 | Editor React Flow, validação, simulador, gatilhos Meta atrás de flags, webhook social | `saiae-crm-sprint6` / feat/sprint6-editor-canais | f69c4c4 | Aprovado com ajustes, corrigidos |
| 7 | Resultados, funil com selo de confiança, importação de agenda, painel, plano do piloto LAVI | `saiae-crm-sprint7` / feat/sprint7-resultados-piloto | 1165ac5 | Aprovado com ajustes, corrigidos |

Estado: **nenhum sprint é DONE em produção.** Todos estão em TESTING local.

Empilhamento das branches: Sprint 7 contém 6, 5, 3 e 2 (por ancestralidade e um merge local). Sprints 1 e 4 são independentes. Simulação de merge (`git merge-tree`) do Sprint 7 com os Sprints 1 e 4: sem conflito de arquivos.

## 2. Testes reais

- Sprint 7 (branch acumulada): `npm test` com 146 arquivos e 2446 testes, 100% na segunda e na terceira execução.
- Na primeira execução da conferência final houve **3 testes falhando sob carga**, sem causa identificada (nomes não capturados). Passaram na repetição. Padrão compatível com tempo limite sob carga, como o teste do `sharp` já visto no baseline. Tratar como risco aberto de teste instável; investigar no CI Linux.
- Cada agente reportou typecheck, lint dos arquivos novos e build com env fictício sem erros. Eu conferi por conta própria apenas testes dos módulos tocados em cada sprint, não typecheck, lint e build.
- Lint do repositório: 173 a 174 erros pré-existentes (baseline). O CI trata lint como informativo.
- Nada foi testado contra MySQL real, navegador real, Railway, Meta ou envio real.

## 3. Problemas encontrados e corrigidos (principais)

- Socket.IO: sem `io.use`, CORS `*`, entrada em qualquer sala. Corrigido (Sprint 1).
- OAuth Meta: redirect final com `request.nextUrl.origin`. Corrigido, com `redirect_uri` preservado.
- Recorrentes e agendamentos: envio antes do claim, ocorrências atrasadas puladas, séries encerradas em silêncio. Corrigido.
- Broadcast: trava em memória após vários `await`. Trocada por `JobLock` no banco.
- Primeira sessão Cloud usada implicitamente em IA, avisos e `codigo-verificacao`. Corrigido, com falha explícita quando ambíguo.
- `canAccessSession` aceitava nome igual ao id de outra sessão. Corrigido (id vence o nome); a mesma regra foi aplicada no módulo de resultados.
- Aprovação editorial: peças reprovadas agendáveis. Bloqueio no PATCH e no agendador, com revogação a partir do manifesto.
- Painel de resultados: selo "confirmado" confirmava o evento e não a origem; importação gravada como confirmada. Corrigido.

## 4. Pendências de schema (nenhuma aplicada; revisão do João antes de qualquer merge)

O repositório não tem `prisma/migrations` e o `Dockerfile` roda `prisma db push` em todo start. Todo merge com schema novo vai direto à produção.

1. `ScheduledMessageAttempt` (Sprint 2, b8929cb)
2. `ExternalPostLink` (Sprint 4, 9ddf389)
3. `AutomationFlow`, `AutomationFlowVersion`, `AutomationRun`, `AutomationStep` (Sprint 5, a5389bf) e coluna `AutomationRun.claimsSemProgresso` (384caf8)
4. `AutomationTriggerEvent` (Sprint 6, c69c7df): sem ela os gatilhos não funcionam; falta retenção
5. `ResultEvent` (Sprint 7, 26be5ee), `importacaoId` (104d330) e o default de `confianca` ajustado para `inferido` (b088394)
6. Propostas, não implementadas: `IaConversa.sessionId`, `IaMensagem.phoneNumberId`, `CloudNumero`, `Empresa`

Recomendação: gerar a migração SQL aditiva com `prisma migrate diff`, revisar, tirar backup testado e aplicar primeiro em staging. O plano está em `plano-migracao-rollback.md`.

## 5. Riscos e limitações restantes

- **Produção sem backup** (registrado na memória do projeto): pré-requisito de qualquer schema novo.
- Repositório do CRM é **público**. Busca por padrões não achou segredo versionado, mas não substitui gitleaks ou trufflehog. Plano de rotação em `incidente-credenciais.md`; senha do `/swagger` está em `NEXT_PUBLIC_*` e vai no bundle.
- Sem `BASE_URL` ou `NEXTAUTH_URL` válidos em produção, o login social cai em `?oauth=nao-configurado`.
- Com 2 ou mais sessões em `WHATSAPP_CLOUD_SESSION_ID` e sem `WHATSAPP_CLOUD_PHONE_MAP` e `WHATSAPP_CLOUD_BARRACA_MAP`, IA, avisos e código de verificação ficam desligados (falha fechada).
- Se `BASE_URL` não for o domínio de acesso, o socket é bloqueado; usar `SOCKET_ALLOWED_ORIGINS`.
- Depois de chamar o provedor, erro genérico do Baileys vira `resultado_desconhecido` e não é retentado: evita duplicar, mas pode perder uma retentativa legítima. Decisão do João.
- `IaConversa` não tem coluna de sessão: o isolamento só vale com uma conta Meta. Não é multiempresa real.
- Automações: `AUTOMACOES_ATIVAS` não deve ligar em produção antes de validação em staging. Limite simultâneo não é atômico entre chaves diferentes. Cancelar não interrompe um envio em curso.
- Nenhum gatilho Meta pode habilitar hoje: faltam as permissões `instagram_manage_messages`, `instagram_manage_comments` e `pages_messaging`, e o executor só envia por WhatsApp.
- Editor visual e painel de resultados: **não vistos em navegador** (contraste, foco, teclado, leitor de tela).
- `GET /api/docs` aceita qualquer `x-api-key`. Risco baixo, não corrigido.
- Importação de agenda: casamento telefone × jid (9º dígito, LID) não validado; falta pedido de exclusão por titular (LGPD).

## 6. Recursos dependentes de aprovação da Meta

Todos os gatilhos sociais (DM Instagram, comentário Instagram, DM Messenger, comentário Messenger, palavra-chave por canal) dependem de: flag ligada, permissões acima aprovadas no app `1093551799927285`, webhook configurado (`SOCIAL_META_APP_SECRET`, `SOCIAL_WEBHOOK_VERIFY_TOKEN`) e um provedor de envio para Instagram e Messenger, que não existe. O diagnóstico em `GET /api/automacoes/gatilhos/diagnostico` lista o motivo de cada um.

## 7. Plano de implantação (proposto; nada executado)

1. João revisa os schemas da seção 4 e decide `Empresa` e as demais propostas.
2. Backup testado do banco de produção. Rotacionar credenciais conforme o plano, se autorizado.
3. Staging: aplicar o SQL aditivo, configurar variáveis (seção 5), rodar os roteiros dos relatórios de cada sprint.
4. Ordem de merge sugerida, uma PR por branch, cada uma com CI verde e deploy em staging antes de produção: Sprint 1, depois 2, depois 3, depois 4, depois 5, depois 6, depois 7 (os Sprints 5 a 7 já incluem 2 e 3, então abrir as PRs na ordem evita duplicar histórico; resolver na hora se o histórico mesclado confundir).
5. Flags desligadas no deploy: `AUTOMACOES_ATIVAS`, flags de gatilhos sociais, `RESULTADOS_ENABLED`. Ligar uma por vez em staging.
6. Produção só com autorização explícita do João, sprint a sprint.

Rollback funcional: reverter só o código que usa as tabelas (ou desligar `AUTOMACOES_ATIVAS`, `RESULTADOS_ENABLED` e os gatilhos) e **preservar os models aditivos no `schema.prisma`**. Reverter também o schema remove os models, e o Dockerfile continua rodando `prisma db push`, que exige confirmação de perda de dados e impede o servidor de iniciar. Remover tabelas é operação separada, só com workers parados, dados reconciliados e backup restaurável testado; a ordem dos `DROP` respeita as FKs, mas não os torna seguros. Detalhes em `plano-migracao-rollback.md` e em cada `sprintN-relatorio.md`.

## 8. Roteiro de homologação final pelo João

1. Staging com schema aplicado e backup feito.
2. Socket.IO: login, abrir a página de uma sessão, ver QR e mensagens; tentar entrar na sala de outro usuário (deve falhar); sessão expirada derruba o socket.
3. OAuth Meta: conectar conta social e conferir que o redirect volta ao domínio correto.
4. Agendamento: criar mensagem única e recorrente em sessão de teste; matar o processo no meio e conferir que não duplica nem perde sem registro; ver `unknown` e `missed` na tabela e as notificações.
5. Multiempresa: duas sessões Cloud com os mapas preenchidos; webhook de cada número só aciona a sessão certa.
6. Agência: gerar `manifesto.json` da LAVI S47 (a peça `story-indique-e-ganhe` está reprovada no `revisao.md`), importar em modo `validar` e depois como rascunho; reimportar para testar idempotência; tentar agendar peça reprovada (deve dar 409).
7. Automações: fluxo de teste no simulador do editor; execução manual em sessão de teste com `AUTOMACOES_ATIVAS` só em staging.
8. Resultados: importar agenda sintética, conferir selos de confiança e o "origem não identificada"; desfazer o lote.
9. Piloto da LAVI conforme `plano-piloto-lavi.md`, só depois de tudo acima.

## 9. Não verificado (resumo)

MySQL real, concorrência real entre instâncias, Railway e Cloudflare (cookie `__Secure-`, proxy de WebSocket), Meta real, navegador, `npm audit`, desempenho de `groupBy` em sessões grandes, CI no GitHub, backup no Railway, valores reais das variáveis de produção, conteúdo de `.env*` locais.
