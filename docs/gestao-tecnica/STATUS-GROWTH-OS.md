# Sai aê Growth OS: estado de execução

Atualizado em 2026-11-13. Documento de retomada: qualquer sessão do Claude Code pode continuar a partir daqui.

## Regras vigentes

- Nada de deploy, push, Railway, Meta real, envio ou publicação real, nem `prisma db push/migrate` em banco real.
- Schema só aditivo, em commit separado `db:`, com revisão do João antes de qualquer merge (o Dockerfile roda `prisma db push` em todo start).
- Cada sprint passa por implementação, revisão independente, correção dos apontamentos e conferência dos testes.
- Nenhum sprint é DONE em produção: todos estão fechados apenas no local.

## Worktrees e branches (todos locais, sem push)

| Sprint | Worktree | Branch | Base | Último commit | Estado |
|---|---|---|---|---|---|
| 0 | `D:\Projetos\_saiae\saiae-crm-growth` | chore/growth-os-base | origin/main 48cb963 | (docs sem commit) | Concluído |
| 1 | `D:\Projetos\_saiae\saiae-crm-sprint1` | fix/sprint1-socket-oauth | 48cb963 | f9fa3e2 | Aprovado, revisado |
| 2 | `D:\Projetos\_saiae\saiae-crm-sprint2` | fix/sprint2-confiabilidade-mensagens | 48cb963 | 5423cc0 | Aprovado, revisado |
| 3 | `D:\Projetos\_saiae\saiae-crm-sprint3` | feat/sprint3-multiempresa | 48cb963 | 737fd27 | Aprovado, revisado |
| 4 | `D:\Projetos\_saiae\saiae-crm-sprint4` | feat/sprint4-agencia-crm | 48cb963 | 8da3ad7 | Aprovado, revisado |
| 5 | `D:\Projetos\_saiae\saiae-crm-sprint5` | feat/sprint5-motor-automacoes | Sprint 3 + merge do Sprint 2 | 08b9fc8 | Aprovado, revisado |
| 6 | `D:\Projetos\_saiae\saiae-crm-sprint6` | feat/sprint6-editor-canais | Sprint 5 | f69c4c4 | Aprovado, revisado |
| 7 | `D:\Projetos\_saiae\saiae-crm-sprint7` | feat/sprint7-resultados-piloto | Sprint 6 | 1165ac5 | Aprovado, revisado |

Todos os sprints implementados e revisados (atualizado após o Sprint 7). Consolidado em `RELATORIO-FINAL-GROWTH-OS.md`. Schemas adicionais pendentes: `AutomationTriggerEvent` (c69c7df), `ResultEvent` (26be5ee), `importacaoId` (104d330) e o default de `ResultEvent.confianca` ajustado para `inferido` (b088394). Teste instável aberto: 3 falhas sob carga numa execução da suíte completa, sem causa identificada. Correções da revisão Codex (13 achados, mais ajustes da revisão das correções) estão nos commits finais dos Sprints 7 (1165ac5) e 4 (8da3ad7).

A branch local `feat/redes-sociais-series` do repositório principal não foi tocada.

## Pendências de schema (nenhuma aplicada; revisão do João antes do merge)

- `ScheduledMessageAttempt` (Sprint 2, commit b8929cb)
- `ExternalPostLink` (Sprint 4, commit 9ddf389)
- `AutomationFlow`, `AutomationFlowVersion`, `AutomationRun`, `AutomationStep` (Sprint 5, commit a5389bf) e a coluna `AutomationRun.claimsSemProgresso` (commit 384caf8)
- Propostas, não implementadas: `IaConversa.sessionId`, `IaMensagem.phoneNumberId`, `CloudNumero`, `Empresa`
- O repositório não tem pasta `prisma/migrations`: o SQL aditivo precisa ser gerado e revisado antes do deploy.

## Itens que dependem do João

1. Rodar gitleaks ou trufflehog e checar `.env*` locais (ver `incidente-credenciais.md`). O repositório do CRM é público.
2. Autorizar ou não a rotação de credenciais (plano em `incidente-credenciais.md`).
3. Confirmar no Railway: `BASE_URL`/`NEXTAUTH_URL` definidas, `SOCKET_ALLOWED_ORIGINS` se houver domínio alternativo, e exatamente 1 sessão em `WHATSAPP_CLOUD_SESSION_ID` (ou os mapas `WHATSAPP_CLOUD_PHONE_MAP` e `WHATSAPP_CLOUD_BARRACA_MAP` preenchidos).
4. Decidir se erro genérico do Baileys após o envio vira `resultado_desconhecido` (comportamento atual do Sprint 2) ou volta a ser retentado.
5. Conferir `story-indique-e-ganhe` da LAVI S47: está REPROVADA no `revisao.md`; o gerador de manifesto a barra.
6. Backup e teste em staging antes de qualquer merge com schema novo.
7. `AUTOMACOES_ATIVAS` não deve ser ligada em produção antes de validar em staging.

## Próximos passos

1. João revisa os schemas pendentes e o `migracao-aditiva-growth-os.sql` (gerado com `prisma migrate diff`, não aplicado).
2. Backup testado, staging, credenciais, variáveis do Railway e ordem de merge (ver "Itens que dependem do João" e `RELATORIO-FINAL-GROWTH-OS.md`).

## Documentos

Todos em `D:\Projetos\_saiae\saiae-crm-growth\docs\gestao-tecnica\` (sem commit): `sprint0-baseline.md`, `arquitetura.md`, `plano-migracao-rollback.md`, `incidente-credenciais.md`, `revalidacao-achados.md`, `agencia-pacote-formato.md`, `contrato-importacao-agencia-crm.md`, `referencia-chatbotx.md`, `RELATORIO-FINAL-GROWTH-OS.md` e `migracao-aditiva-growth-os.sql`. Este STATUS também fica nesta pasta. Os relatórios de sprint ficam em `docs/gestao-tecnica/` de cada worktree.

Agência: três arquivos novos e não commitados em `D:\agencia-marketing\scripts\` (`gerar_manifesto.py`, `enviar_crm.py`, `test_gerar_manifesto.py`).
