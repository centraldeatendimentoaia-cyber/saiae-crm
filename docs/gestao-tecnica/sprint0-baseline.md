# Sprint 0: baseline técnico e estratégia de branches

Data: 2026-11-13. Worktree `D:\Projetos\_saiae\saiae-crm-growth`, branch `chore/growth-os-base`, criada de `origin/main` no commit `48cb963` (o que está em produção no Railway). Máquina: Windows 11, Node local, execução sem alterar nenhum arquivo do projeto fora de `docs/gestao-tecnica/`.

## 1. Baseline real

Variáveis usadas apenas no processo, todas fictícias (as mesmas do CI): `DATABASE_URL=mysql://ci:ci@localhost:3306/ci`, `AUTH_SECRET` de teste, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_URL`. Nenhum `.env` foi lido e nenhum banco real foi acessado.

| Etapa | Comando | Resultado | Tempo |
|---|---|---|---|
| Instalação | `npm ci` (sem `--legacy-peer-deps`) | OK, exit 0. Avisos de peer deps (swagger-ui-react com react 19) e aviso de `allow-scripts` pendentes de aprovação (prisma, protobufjs, sharp, tree-sitter-json, unrs-resolver). | 3 min 23 s |
| Cliente Prisma | `npx prisma generate` | OK | 2 s |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | OK, 0 erros | 10 s |
| Testes | `npm test` (vitest run) | **FALHOU**: 128 arquivos, 127 passam e 1 falha; 2.156 testes, 2.155 passam e 1 falha | 13 s |
| Lint | `npm run lint` (eslint) | **FALHOU**: 332 problemas, 174 erros e 158 avisos | 39 s |
| Build | `npm run build` (next build, Turbopack) | OK, exit 0, compilou e gerou as rotas | 251 s (compilação 82 s, o restante em TypeScript e geração de páginas) |

### 1.1 Falhas pré-existentes (não corrigidas, fora do escopo)

**Testes.** Arquivo `src/modules/whatsapp/provider/capability-routes.test.ts`, suíte "rotas só-Baileys". Falha por `Test timed out in 5000ms` (limite padrão do vitest) em testes que importam a rota de figurinha (que carrega `sharp`/`wa-sticker-formatter` a frio).
- Na execução completa: 1 teste falhou (`'figurinha' ('POST'): 501 em sessão Cloud API`, 5.834 ms).
- Reexecução isolada do arquivo: 2 testes falharam pelo mesmo motivo (54 de 56 passaram).
- Diagnóstico: não é falha de lógica de asserção; é tempo de carga fria acima de 5 s nesta máquina (Windows). Provavelmente passa no CI Linux (o CI do projeto está verde segundo o histórico dos PRs, mas não foi consultado aqui). Correção sugerida para depois: `testTimeout` maior ou mock do módulo de figurinha nesse teste.

**Lint.** 174 erros, distribuídos assim:

| Regra | Erros |
|---|---|
| `@typescript-eslint/no-explicit-any` | 106 |
| `react/no-unescaped-entities` | 34 |
| `@typescript-eslint/no-require-imports` | 12 |
| `@typescript-eslint/ban-ts-comment` | 9 |
| regras do React Compiler (`react-hooks/*`, mensagens "renders"/"value") | cerca de 12 |
| `react-hooks/rules-of-hooks` | 1 |

Os 158 avisos são em sua maioria `no-unused-vars`. O CI trata o lint como informativo (`continue-on-error`), por isso o main está "verde" apesar disso. O erro `rules-of-hooks` merece triagem como possível bug real.

**Observações do build.** Passou sem erros de TypeScript. Não houve falha pré-existente.

### 1.2 Divergências entre local, Dockerfile e CI

- Local e CI/Docker: o CI e o Dockerfile instalam com `npm ci --legacy-peer-deps`; aqui `npm ci` puro funcionou. Definir uma política (manter a flag ou removê-la, já que não é necessária hoje).
- A tabela de "scripts bloqueados" do npm (`allow-scripts`) não impediu o `generate` nem o build, mas convém registrar a aprovação explícita dos pacotes.
- O comando `rtk` do ambiente condensa a saída de alguns comandos; os números acima foram obtidos dos logs completos.

## 2. Critérios de "verde" propostos para os próximos sprints

1. `npm run typecheck` e `npm run build` sem erro (já atendem).
2. `npm test` sem falhas. Pré-requisito: corrigir o timeout do teste de figurinha (tarefa pequena, no Sprint 1).
3. Lint: não aumentar os 174 erros (regra de "não piorar"); reduzir por lote (primeiro `no-unescaped-entities` e `no-require-imports`, que são mecânicos).
4. Mudanças em `prisma/schema.prisma` só aditivas, ver `plano-migracao-rollback.md`.

## 3. Estratégia de branches e worktrees

Contexto: a produção deploya a partir da `main` (Railway, Dockerfile), e o `start` roda `prisma db push`. Portanto, `main` precisa ficar sempre implantável e toda mudança de schema é uma mudança de produção.

### 3.1 Convenções

- Base única: `origin/main`. Branch de integração do Growth OS: `chore/growth-os-base` (esta) apenas para documentação, scaffolding e ajustes de tooling do Sprint 0.
- Uma branch por entrega, curta, com prefixo:
  - `feat/growth-<tema>` para funcionalidade (ex.: `feat/growth-leads-pipeline`);
  - `fix/<tema>` para correção;
  - `chore/<tema>` para tooling, CI e docs;
  - `db/<tema>` exclusivamente para mudança de schema/migração, revisada à parte.
- Merge por PR com squash para a `main`; CI (`verify`) obrigatório. Marcar a `main` como protegida (sem push direto) se ainda não estiver.
- Rebase sobre `origin/main` antes do PR; evitar branches de longa duração.

### 3.2 Worktrees (um por frente, pastas irmãs)

Sob `D:\Projetos\_saiae\`, mantendo `saiae-crm` intocado como cópia de referência de produção:

| Worktree | Branch | Uso |
|---|---|---|
| `saiae-crm` | `main` (existente) | Referência da produção e hotfix. Não desenvolver aqui. |
| `saiae-crm-growth` | `chore/growth-os-base` | Docs e tooling do Sprint 0. |
| `saiae-crm-growth-<sprint>-<tema>` | `feat/growth-<tema>` | Uma por entrega paralela. Criar com `git worktree add ..\saiae-crm-growth-s1-<tema> -b feat/growth-<tema> origin/main`. |
| `saiae-crm-db` | `db/<tema>` | Só para mudanças de schema, com MySQL local descartável. |

Regras práticas: `npm ci` é por worktree (3 min na primeira vez; considerar copiar `node_modules` ou usar cache de pacotes do npm); nunca compartilhar `.env` real entre worktrees, usar um `.env.local` fictício apontando para MySQL local; remover o worktree (`git worktree remove`) ao concluir a entrega.

### 3.3 Sequência sugerida de sprints (o que cada branch carrega)

1. **Sprint 1 (segurança do caminho de produção).** `chore/ci-schema-guard` (passo de CI contra mudança destrutiva de schema), `fix/teste-figurinha-timeout`, confirmação do backup agendado. Sem mudança de comportamento.
2. **Sprint 2 (migrações).** `db/baseline-migrate`: pasta `prisma/migrations/0_init`, depois `chore/release-migrate-deploy` trocando `db push` por `migrate deploy` (plano em `plano-migracao-rollback.md`). Primeiro em staging.
3. **Sprints seguintes (funcionalidade Growth OS).** Uma `feat/growth-*` por capacidade, cada uma com tabelas novas aditivas numa branch `db/*` separada quando houver schema, para que o schema possa entrar na `main` e ser aplicado/validado antes do código que o usa (expand/contract).
4. Limpeza de lint em lotes pequenos (`chore/lint-<regra>`), intercalada, sem misturar com funcionalidade.

### 3.4 Gates de merge

- CI `verify` verde; revisão do diff de `schema.prisma` (aditivo, sem renomear/remover); sem segredos; mudança de produção (schema, variável de ambiente, Meta) com aval explícito do João antes do merge.
- Deploy só a partir da `main`, nunca a partir de branch de feature.

## 4. Pendências e riscos desta fase

- Não verificado: estado real do CI no GitHub, backup agendado no Railway, banco de produção (proibido acessar nesta fase).
- A falha do teste de figurinha precisa ser confirmada em Linux (CI) antes de classificá-la como só de ambiente.
- Arquivos novos estão sem commit: `docs/gestao-tecnica/sprint0-baseline.md`, `arquitetura.md`, `plano-migracao-rollback.md` (a pasta já continha `agencia-pacote-formato.md` e `contrato-importacao-agencia-crm.md`, não alterados).
