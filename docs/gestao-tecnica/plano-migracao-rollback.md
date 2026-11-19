# Risco do `prisma db push`, plano de migração e rollback

Data: 2026-11-13. Base: commit `48cb963`. Este documento é um plano; nada aqui foi executado contra qualquer banco.

## 1. Situação atual

- Não existe `prisma/migrations`. O schema vive só em `prisma/schema.prisma`.
- O `CMD` do `Dockerfile` roda `npx prisma db push` antes de subir o servidor, em todo start do container no Railway (deploy, restart por falha, reinício manual). Não há `--accept-data-loss`, portanto o Prisma recusa mudanças destrutivas em modo não interativo (a CLI aborta com erro), mas isso derruba o start: o `&&` impede o servidor de subir e o healthcheck falha.
- `start.sh` (VPS/PM2) e `npm run db:push` também usam `db push`.
- A equipe já trata o risco por convenção (docs de spec: "só tabelas novas e colunas opcionais ou com default; nunca renomear, apagar ou mudar tipo"), mas nada no pipeline impõe isso.

## 2. O que o `db push` pode fazer em produção

`db push` compara o schema com o estado real do banco (introspecção) e aplica o diff direto, sem histórico, sem revisão e sem arquivo SQL.

| Mudança no schema | Efeito |
|---|---|
| Modelo/tabela novo | Cria a tabela. Seguro. |
| Coluna nova opcional ou com default | `ALTER TABLE ADD COLUMN`. Seguro (em tabelas grandes, o MySQL 8 faz de forma instantânea ou rápida, mas pode bloquear metadados). |
| Coluna nova obrigatória sem default | Falha se a tabela tiver linhas; o Prisma avisa e aborta sem `--accept-data-loss`. |
| Remover coluna ou tabela | Perde dados. Exige `--accept-data-loss`; sem a flag, aborta e derruba o start. |
| Renomear campo/modelo | O Prisma vê como remover + criar: apaga dados da coluna antiga. |
| Mudar tipo (ex.: `String` para `Int`, `VARCHAR(191)` para menor) | Pode truncar ou falhar; perda de dados. |
| Novo `@unique` ou `@@unique` com duplicatas existentes | Falha ao criar o índice (aborta o start). |
| Trocar `onDelete`/relação | Recria chave estrangeira; pode falhar com dados órfãos. |
| Remover índice | Aplica sem aviso; pode degradar consultas em silêncio. |
| Divergência manual no banco (alguém criou coluna/índice direto) | `db push` tenta "corrigir" o banco para igualar o schema, removendo o que não está no schema. |

Riscos adicionais específicos deste projeto:

1. **Schema direto na produção a cada merge**: qualquer PR que toque `schema.prisma` altera o banco de produção no próximo deploy, sem aprovação separada do SQL.
2. **Staging e produção compartilham a regra**: um erro vira incidente de produção ao fazer merge na `main`.
3. **Sem backup obrigatório antes**: nada no start garante backup. O script `db:backup` existe, mas depende de um serviço de cron no Railway que precisa ser confirmado (memória do projeto registra "produção sem backup").
4. **Concorrência no start**: durante deploy sobreposto, duas instâncias podem rodar `db push` ao mesmo tempo.
5. **Cascatas**: `User` e `Session` têm filhos com `onDelete: Cascade` (20 relações). Um erro de relação ou um script de limpeza apaga mensagens e contatos em cadeia.
6. **Tabelas fora do schema**: se existirem tabelas criadas manualmente no mesmo banco, o `db push` pode propor removê-las. Verificar antes (ver fase 0).
7. **Start lento e frágil**: o healthcheck tem 120 s; um `ALTER` demorado em tabela grande (`Message`) pode estourar o tempo e entrar em loop de restart.

## 3. Mitigações imediatas (sem trocar de ferramenta)

1. Congelar a regra: PR que altera `schema.prisma` precisa de revisão explícita (marcar com label e checklist no template de PR) e só pode conter mudanças aditivas.
2. No CI, adicionar um passo que gera o diff do schema contra a `main` e falha se houver remoção, renomeação ou mudança de tipo (por exemplo `prisma migrate diff --from-schema-datamodel <main> --to-schema-datamodel <PR> --script` e inspeção do SQL por palavras `DROP`, `MODIFY`, `RENAME`).
3. Garantir backup agendado do MySQL de produção (`npm run db:backup` como serviço com Cron no Railway, destino S3/R2) e fazer um backup manual antes de qualquer merge que mexa no schema.
4. Nunca usar `--accept-data-loss` no `CMD` nem em scripts.
5. Testar toda mudança de schema primeiro no staging com cópia (dump restaurado) dos dados de produção.

## 4. Plano de migração para `prisma migrate` (baseline)

Objetivo: histórico versionado, SQL revisável, aplicação com `prisma migrate deploy` (que só aplica migrações pendentes e nunca "corrige" o banco removendo coisas). Tudo abaixo vale para execução futura, com aprovação do João.

### Fase 0. Pré-requisitos (somente leitura)

1. Confirmar com o João o banco e o ambiente (produção e staging no Railway) e ter credenciais fora do repositório.
2. Fazer **backup completo** do banco de produção (`mysqldump` via `npm run db:backup` ou snapshot do Railway) e **testar a restauração** em um MySQL local ou de staging.
3. Verificar a paridade entre schema e banco: `prisma migrate diff --from-url <banco de produção> --to-schema-datamodel prisma/schema.prisma --script` (rodado contra um dump restaurado, não contra a produção). A saída deve ser vazia. Se não for vazia, o schema e o banco já divergem e isso precisa ser entendido antes do baseline (ver riscos 6 e do item de divergência).
4. Congelar merges de schema durante a janela.

### Fase 1. Gerar a migração baseline (em máquina local, sem tocar produção)

1. Subir um MySQL 8 vazio descartável (docker-compose local).
2. Criar a pasta e o SQL do estado atual:
   `mkdir -p prisma/migrations/0_init` e
   `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql`.
3. Validar: aplicar `0_init` no MySQL vazio com `prisma migrate deploy` e rodar `prisma migrate diff --from-url <mysql local> --to-schema-datamodel prisma/schema.prisma --exit-code` (deve retornar 0).
4. Adicionar `prisma/migrations/migration_lock.toml` (provider `mysql`).
5. Abrir PR com a pasta de migrações (sem mudar o `CMD` ainda).

### Fase 2. Marcar a baseline como aplicada em staging e produção

Em bancos que já têm as tabelas, a baseline **não deve ser executada**, apenas registrada:

`npx prisma migrate resolve --applied 0_init`

Isso cria a tabela `_prisma_migrations` com a entrada `0_init` sem rodar SQL. Ordem: staging primeiro, validar, depois produção (com backup recente). É a única escrita no banco e é só a tabela de controle.

### Fase 3. Trocar o start

1. Alterar o `CMD` do Dockerfile: `npx prisma migrate deploy` no lugar de `npx prisma db push`.
2. Melhor ainda (recomendado): tirar a migração do start e rodá-la como passo de release do Railway (pre-deploy command: `npx prisma migrate deploy`), assim uma falha de migração impede o deploy em vez de entrar em loop de restart, e não há corrida entre instâncias.
3. Atualizar `start.sh`, `package.json` (`db:push` vira `db:migrate`) e a documentação (`DATABASE_SETUP.md`, `DEPLOY-RAILWAY.md`).
4. Novo fluxo de desenvolvimento: `prisma migrate dev --name <mudança>` localmente, commitar a pasta gerada; CI valida com `migrate diff --exit-code` que schema e migrações estão sincronizados.

### Fase 4. Regras de convivência (expand/contract)

Mudanças destrutivas passam a ser feitas em duas migrações separadas por pelo menos um deploy: (1) adicionar o novo e migrar o código; (2) só então remover o antigo, depois de confirmar backup e ausência de uso.

## 5. Plano de rollback

O `migrate` não tem "down" automático. O rollback é por camadas:

| Cenário | Ação |
|---|---|
| Fase 1 ou 3 deu errado no PR/CI | Reverter o commit; nada tocou o banco. |
| Fase 2: `migrate resolve` registrou erradamente | Remover a linha de `_prisma_migrations` (`npx prisma migrate resolve --rolled-back 0_init` ou `DELETE` manual) e voltar o `CMD` para `db push`. Nenhuma tabela de negócio foi alterada. |
| Fase 3: deploy novo falha por migração | O release step falha, o Railway mantém a versão anterior no ar. Reverter para o deploy anterior no painel do Railway e o `CMD` antigo; corrigir a migração em PR. |
| Migração futura aplicada com erro lógico (dados) | Para mudança aditiva: escrever migração corretiva (nova, sem editar a antiga). Para perda de dados: restaurar o backup anterior à migração (verificar o tempo de queda e a perda de dados entre o backup e a restauração; por isso o backup imediato antes de cada migração de schema é obrigatório). |
| Migração parcialmente aplicada (MySQL não tem DDL transacional) | `npx prisma migrate resolve --rolled-back <nome>` após desfazer manualmente os passos aplicados (SQL revisado), depois reaplicar a versão corrigida. |

### Rollback funcional dos módulos aditivos (Growth OS)

Para desfazer o efeito de automações, resultados, anti-reenvio e gatilhos sem perder dados: **preservar os models aditivos no `schema.prisma`** e reverter só o código que os usa, ou desligar `AUTOMACOES_ATIVAS`, `RESULTADOS_ENABLED` e os gatilhos. Reverter também os commits do schema remove os models, e como o Dockerfile ainda roda `prisma db push`, o comando passa a exigir confirmação de perda de dados e o servidor não inicia. Os `DROP` comentados em `migracao-aditiva-growth-os.sql` apagam resultados e registros antirreenvio; remover tabelas é uma operação separada, só com workers parados, dados reconciliados e backup restaurável testado. A ordem dos `DROP` respeita as FKs, mas isso não a torna segura.

Pontos de verificação antes de cada `migrate deploy` em produção: backup recente (menos de 1 hora) e restauração já testada; SQL da migração revisado por uma segunda pessoa (ou pelo João); janela de baixo uso; plano de reversão do deploy anotado.

## 6. Recomendações priorizadas

1. (Agora, sem risco) Confirmar e agendar backup automático em produção.
2. (Sprint 1) Passo de CI que bloqueia mudanças destrutivas de schema.
3. (Sprint 1 ou 2) Fases 0 a 2 do baseline, primeiro em staging.
4. (Sprint 2) Fase 3: pre-deploy command com `migrate deploy`, remover `db push` do `CMD`.
5. Manter a regra aditiva enquanto o passo 4 não estiver em produção.
