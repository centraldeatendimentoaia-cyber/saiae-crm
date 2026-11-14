# Sprint 4 (Agência + CRM): relatório

Branch `feat/sprint4-agencia-crm`, base `48cb963` (produção). Dois commits locais, sem push: `9ddf389` (`db:`, schema) e `781f747` (código, testes). Nada foi publicado, agendado, implantado nem enviado à Meta; nenhum `prisma db push/migrate` foi rodado; nenhum segredo foi lido.

## 1. Itens: causa/lacuna, solução, arquivos

### 1.1 Bloqueio editorial (achado 8)
- Lacuna: `PATCH /api/social/posts/:id` com `publishAt` põe qualquer rascunho em `PENDING`; o CRM não conhecia estado editorial.
- Solução mínima: o estado editorial vive no vínculo externo (`ExternalPostLink.editorial`). `PATCH` com `publishAt` recusa com `409 {codigo:"editorial_bloqueado"}` se o post tem vínculo com `editorial != "aprovado"`. Quando a agência reenvia a peça como reprovada, bloqueada pelo lint ou pendente, o vínculo é travado e um post já `PENDING` volta a `DRAFT` sem data. Rede de segurança: `publishOne` (agendador) não publica post cujo vínculo esteja bloqueado. Post criado manualmente não tem vínculo e segue exatamente como antes (teste de regressão). Nova versão aprovada (versão maior) destrava.
- Arquivos: `src/app/api/social/posts/[id]/route.ts` (+1 import, +5 linhas), `src/modules/social/scheduler.ts` (+2 linhas), `src/modules/social/importar-pacote.ts` (`bloqueioEditorial`, `revogar`).

### 1.2 Endpoint de importação idempotente (achado 9)
- `POST /api/social/importar-pacote`: multipart (`manifesto` JSON + um arquivo por `midias[].ref`, ou `nome` se não houver `ref`) ou JSON puro (só útil em `validar`). Autenticação `x-api-key` existente, tudo por `userId`.
- Validação do lote (recusa tudo, nada gravado): `contrato`, `cliente`, `semana`, 1 a 60 peças, e `contas.padrao` (+ `carrossel`/`stories` opcionais) precisam ser contas `instagram` do dono da chave; senão `404 conta_nao_encontrada`.
- Por peça (falha isolada): `status_nao_aprovado`, `lint_com_erro` (lint ausente conta como erro), `formato_nao_suportado` (reel), `hash_invalido` (o servidor recalcula o hash), `legenda_longa`, `midia_invalida` (arquivo ausente, mime, 5 MB, sha256 diferente do arquivo, regras de 1 a 10 imagens e story com 1, reaproveitando `parseContent`), `quota_midia` (`quotaMidiaBytes`), `versao_antiga`, `conflito_publicado`, `item_invalido`.
- Idempotência: chave `cliente:semana:slug`. Mesmo hash: `inalterado` (sem tocar em nada, nem mídia). Hash novo e versão maior com post `DRAFT`/`PENDING`: `atualizado` (mídias novas, as antigas removidas, post volta a `DRAFT` sem data para um humano reaprovar). Hash novo e versão menor ou igual: `versao_antiga`. Post em `PUBLISHING/PUBLISHED/FAILED/PAUSED`: `conflito_publicado`.
- Sempre `DRAFT`, `publishAt` nulo; data+hora planejadas (Brasília, UTC-3) vão para `ExternalPostLink.plannedAt`. Legenda final = legenda + linha em branco + hashtags. Story descarta a legenda e devolve aviso. Mídia reaproveita `mediaStorage.save` e `ensurePublicTokens` (mesma quota e URL pública do upload existente).
- Resposta: `lote`, `resumo`, e por item `externalKey`, `resultado`, `postId`, `groupId`, `mediaIds`, `estado`, `urlPainel`, `avisos` ou `erro{codigo,mensagem}`. Modo `validar` (padrão) roda tudo sem gravar.
- Schema: tabela nova `ExternalPostLink` (commit `db:`), apenas aditiva; `ScheduledPost` e `MediaFile` não mudaram.
- Arquivos: `src/modules/social/importar-pacote.ts`, `src/app/api/social/importar-pacote/route.ts`, `prisma/schema.prisma`.

### 1.3 Retorno de estado
- `GET /api/social/importar-pacote/estado?keys=a,b` ou `?cliente=lavi&semana=2026-S47`: por chave devolve versão, hash, estado editorial, `postId`, `groupId`, `mediaIds`, `estado` (`DRAFT|PENDING|PAUSED|PUBLISHING|PUBLISHED|FAILED|REMOVIDO`), `plannedAt`, `publishAt`, `releaseId`, `releaseUrl`, `publishedAt`, `erro`, `urlPainel`. Só enxerga vínculos do próprio `userId`. Arquivo: `src/app/api/social/importar-pacote/estado/route.ts`.

### 1.4 Lado agência (`D:\agencia-marketing`, sem commit, nenhum arquivo existente alterado)
Três arquivos NOVOS em `scripts/`:
- `gerar_manifesto.py <cliente> <semana>`: lê `pacote/agendamento.csv` e as pastas de post (somente leitura), gera `pacote/manifesto.json` no contrato. Só linhas `aprovado`; calcula sha256 das mídias e o hash da peça (mesmo algoritmo do CRM, com vetor comum nos dois testes); não sobrescreve (exige `--atualizar`, que sobe a `versao` só das peças cujo hash mudou); `--saida` escolhe outro destino.
- `enviar_crm.py enviar|estado`: monta o multipart e chama o CRM. Por padrão é simulação (não toca a rede); `--enviar` faz o envio; sem `--importar` o modo é `validar`. A chave vem só de `CRM_API_KEY` e nunca é impressa. Grava o retorno em `pacote/importacao-crm.json` sem sobrescrever. Não foi executado envio real.
- `test_gerar_manifesto.py`: 5 testes `unittest` com fixtures sintéticas em pasta temporária.
- Como usar (staging, sem publicar): ver seção 5.

### 1.5 Testes
`src/modules/social/importar-pacote.test.ts`, 22 testes, banco em memória e fixtures sintéticas do piloto LAVI: importar (mídia, conta, horário, ids); `validar` sem gravar; reimportar idêntico (zero duplicata, inclusive mídia); nova versão (mesmo post, mídia trocada); versão antiga; conflito com post publicado; reprovado, pendente, bloqueado e lint com erro recusados com código; mídia faltando e adulterada; hash adulterado, reel, legenda longa; story; conta de outro usuário, facebook e inexistente recusam o lote; sem autenticação (401); chave de outro usuário não vê o vínculo e a mesma chave externa em outro usuário não colide; impossibilidade de agendar reprovado (e lint, e agendado que volta a rascunho); destrava com versão nova aprovada; agendador não publica peça bloqueada; regressão do fluxo manual; vetor de hash igual ao do Python.

## 2. Resultados reais
| Verificação | Resultado |
|---|---|
| `npm ci` | ok (622 pacotes) |
| `npx prisma generate` | ok |
| `npx prisma validate` (com `DATABASE_URL` fictícia) | schema válido |
| `npm run typecheck` | `tsc --noEmit`: sem erros |
| `npm test` (suíte completa) | 129 arquivos, 2178 testes passaram (22 novos) |
| Lint nos arquivos alterados/novos | 0 problemas. A pasta `src/modules/social` já tinha 4 erros `no-explicit-any` em `social.test.ts` e outros arquivos `api/social` fora do escopo (pré-existentes, não tocados) |
| `npm run build` (env fictício só no processo) | build concluído e rotas listadas. Aparecem logs `prisma:error` porque algumas páginas tentam consultar o banco fictício no build (comportamento preexistente, não bloqueia) |
| Python `py -m unittest scripts/test_gerar_manifesto.py` | 5 de 5 ok |
| Leitura real LAVI 2026-S47 (só leitura, saída em pasta temporária) | manifesto com as 9 peças aprovadas (7 stories, 2 carrosséis, 4 slides cada) no formato certo; nada gravado no repositório da agência |

## 3. Não verificado
- Nenhum teste contra MySQL real, Next em execução ou staging: os testes usam banco em memória e chamam os handlers diretamente. Comportamento real de `request.formData()` com PNGs grandes, tamanho de corpo máximo da plataforma (Railway/Next) e tempo de upload de ~9 peças não foram medidos.
- A tabela `ExternalPostLink` nunca foi aplicada a um banco; só `prisma validate` e `generate`.
- Conferência cruzada do `handle` do CTA com `SocialAccount.username` (contrato 3.6) não foi feita; a fronteira de tenant é só a chave de API.
- Unicidade concorrente (duas importações simultâneas da mesma chave): coberta por desfazimento no erro de unicidade (tratamento no código, simulado no banco em memória), não testada em banco real.
- O MCP `saiae-crm` e o escritório de IA não foram tocados nem adaptados.

## 4. Riscos e limites
- Schema: ver seção 6. Com `prisma db push` em todo start, o merge cria a tabela em produção no próximo deploy.
- Atualização de peça sobrescreve legenda e mídia do rascunho; se alguém editou o rascunho à mão no CRM, a nova versão da agência vence (post volta a `DRAFT`).
- `lint.erros` e o status vêm da agência (CSV); o CRM confia no manifesto. O `revisao.md` (reprovação textual) não é lido pelo gerador: reprovação do revisor só chega ao CRM se o CSV deixar de dizer `aprovado` e a peça for reenviada com `--incluir-nao-aprovados` (para revogar um vínculo já existente). Decisão de processo pendente com o João.
- Chave de API continua dando acesso total ao usuário; o bloqueio editorial é de cliente honesto (quem tem a chave pode, por outra rota, criar post novo agendado). Ele protege peça importada, não o CRM inteiro.
- Mídias: cada importação nova de versão grava as imagens de novo (sem dedupe por checksum) e remove as antigas; respeita a quota.
- Reel: recusado (`formato_nao_suportado`). A conta por formato é escolhida por `contas.*`, não inferida.
- Hash: o contrato diz "lista ordenada de sha256"; foi implementado como ordem dos slides (ordem importa para o conteúdo). Agência e CRM precisam usar a mesma versão do algoritmo.

## 5. Roteiro de staging (LAVI, 2026-S47, sem publicar)
Pré-requisito: schema da seção 6 aplicado no banco de staging (por revisão do João).
1. No CRM de staging: confirmar usuário da LAVI, gerar a chave de API e anotar o `SocialAccount.id` do Instagram. Não usar o usuário de produção.
2. Na agência: `py scripts/gerar_manifesto.py lavi 2026-S47` (gera `pacote/manifesto.json`; confira as 9 peças).
3. `set CRM_API_KEY=...` (no ambiente, não em arquivo) e `py scripts/enviar_crm.py enviar lavi 2026-S47 --url <staging> --conta-padrao <id>`: simulação. Depois com `--enviar` (modo `validar`): esperado `criado: 9`, nada gravado.
4. Importar: `... --importar --enviar`. Esperado 9 rascunhos; conferir em `/dashboard/redes-sociais/rascunhos` legenda+hashtags, ordem dos slides e conversão PNG para JPEG da URL pública. Nada deve estar em `PENDING`.
5. Repetir o passo 4 (renomear `importacao-crm.json` antes): esperado `inalterado: 9`, sem mídia nova.
6. Alterar uma legenda, `py scripts/gerar_manifesto.py lavi 2026-S47 --atualizar`, reenviar: esperado 1 `atualizado` (versao 2).
7. Reprovação: reenviar uma peça com status diferente de aprovado e conferir que `PATCH publishAt` devolve 409 `editorial_bloqueado`. NÃO agendar peça real: se for preciso testar o agendamento, usar uma conta de teste, nunca a da LAVI.
8. `py scripts/enviar_crm.py estado lavi 2026-S47 --url <staging>`: conferir estados.

## 6. Rollback e pendências de schema
- Pendência de schema: o commit `9ddf389` (`db:`) adiciona a tabela `ExternalPostLink` (colunas `id, userId, source, externalKey, version, contentHash, editorial default "aprovado", postId, plannedAt, meta, createdAt, updatedAt`; únicos/índices `(userId,source,externalKey)`, `postId`, `(userId,source)`). Só aditiva, nenhuma coluna existente muda. Conforme `plano-migracao-rollback.md`, EXIGE revisão do João antes do merge, com backup recente e teste em staging antes. Não foi rodado `db push`.
- Rollback do código: `git revert 781f747` desliga rotas e bloqueio (o PATCH e o agendador voltam ao comportamento anterior). Posts importados continuam como rascunhos normais.
- Rollback do schema: a tabela vazia ou sem uso pode ficar sem prejuízo. Para removê-la, `DROP TABLE ExternalPostLink` manual depois de reverter o código (o `db push` sem `--accept-data-loss` não a removerá sozinho enquanto estiver no schema; ao revertê-lo ela vira divergência do banco, que o `db push` recusará remover com dados; revisar antes). Preferir deixar a tabela e reverter só o código.
- Dados: remover itens importados = apagar os `ScheduledPost` (rascunhos) pelo painel; os vínculos órfãos aparecem como `REMOVIDO` na consulta de estado.
